import Foundation

/// Tencent's billing/cost API — TC3-signed POST/JSON to `billing.tencentcloudapi.com`.
/// Returns the same `MonthToDateCost`/`ServiceCost` shapes `CostExplorerClient` uses; they're
/// provider-agnostic already. Unverified against a live account — see TencentCAMClient's note.
enum TencentBillingClient {
    private static let host = "billing.tencentcloudapi.com"
    private static let service = "billing"
    private static let version = "2018-07-09"

    static func monthToDateCost(credential: AWSSigV4Signer.Credential) async throws -> MonthToDateCost {
        let now = Date()
        let monthStart = monthCalendar.date(from: monthCalendar.dateComponents([.year, .month], from: now))!

        async let costResult = cost(begin: monthStart, end: now, credential: credential)
        async let balanceResult = accountBalance(credential: credential)
        var result = try await costResult
        result.balance = try? await balanceResult
        return result
    }

    /// Every month from `monthsBack` months ago through the current (in-progress) month —
    /// unlike AWS, Tencent's billing API has no multi-month-in-one-call mode, so this fans
    /// out `monthsBack + 1` concurrent requests.
    static func monthlyBills(monthsBack: Int, credential: AWSSigV4Signer.Credential) async throws -> [MonthToDateCost] {
        let now = Date()
        let currentMonthStart = monthCalendar.date(from: monthCalendar.dateComponents([.year, .month], from: now))!

        return try await withThrowingTaskGroup(of: MonthToDateCost.self) { group in
            for offset in 0...monthsBack {
                group.addTask {
                    let monthStart = monthCalendar.date(byAdding: .month, value: -offset, to: currentMonthStart)!
                    let end = offset == 0 ? now : monthCalendar.date(byAdding: .second, value: -1, to: monthCalendar.date(byAdding: .month, value: 1, to: monthStart)!)!
                    return try await cost(begin: monthStart, end: end, credential: credential)
                }
            }
            var results: [MonthToDateCost] = []
            for try await item in group { results.append(item) }
            return results.sorted { $0.periodStart > $1.periodStart }
        }
    }

    private static func cost(begin: Date, end: Date, credential: AWSSigV4Signer.Credential) async throws -> MonthToDateCost {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Total: Decodable { let RealTotalCost: String? }
                struct Overview: Decodable { let BusinessCodeName: String; let BusinessCode: String?; let RealTotalCost: String? }
                let SummaryTotal: Total?
                let SummaryOverview: [Overview]?
            }
            let Response: Body
        }
        let payload = ["BeginTime": dateTimeFormatter.string(from: begin), "EndTime": dateTimeFormatter.string(from: end)]
        let data = try await TencentAPIClient.request(host: host, service: service, action: "DescribeBillSummaryByProduct", version: version, payload: payload, credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)

        let total = decoded.Response.SummaryTotal?.RealTotalCost.flatMap(Double.init) ?? 0
        let byService = (decoded.Response.SummaryOverview ?? [])
            .compactMap { item -> ServiceCost? in
                guard let amount = item.RealTotalCost.flatMap(Double.init), amount > 0 else { return nil }
                return ServiceCost(serviceName: item.BusinessCodeName, amount: amount, code: item.BusinessCode)
            }
            .sorted { $0.amount > $1.amount }

        let month = monthFormatter.string(from: begin)
        return MonthToDateCost(periodStart: "\(month)-01", periodEnd: month, total: total, unit: "CNY", byService: byService, isEstimated: true)
    }

    /// One product's bill for a month (`yyyy-MM`) from its bill details — each row is one
    /// resource's charge split into billing items (storage, traffic, requests, …). Tencent
    /// keeps these for every month, so unlike AWS the per-resource split covers the whole period.
    static func serviceDetail(product: ServiceCost, month: String, credential: AWSSigV4Signer.Credential) async throws -> ServiceCostDetail {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Detail: Decodable {
                    struct Component: Decodable { let ItemCodeName: String?; let ComponentCodeName: String?; let RealCost: String? }
                    let ResourceId: String?
                    let ComponentSet: [Component]?
                }
                let DetailSet: [Detail]?
                let Total: Int?
            }
            let Response: Body
        }
        let pageSize = 100, maxPages = 20
        func page(_ offset: Int) async throws -> Response.Body {
            var payload: [String: Any] = ["Month": month, "Offset": offset, "Limit": pageSize, "NeedRecordNum": 1]
            if let code = product.code { payload["BusinessCode"] = code }
            let data = try await TencentAPIClient.request(host: host, service: service, action: "DescribeBillDetail", version: version, payload: payload, credential: credential)
            return try JSONDecoder().decode(Response.self, from: data).Response
        }

        // Sequential: DescribeBillDetail is rate-limited to a few calls a second.
        let first = try await page(0)
        let pages = min(((first.Total ?? 0) + pageSize - 1) / pageSize, maxPages)
        var details = first.DetailSet ?? []
        for index in stride(from: 1, to: pages, by: 1) {
            details += try await page(index * pageSize).DetailSet ?? []
        }

        var byResource: [String: [(String, Double)]] = [:]
        for detail in details {
            for component in detail.ComponentSet ?? [] {
                let item = component.ItemCodeName ?? component.ComponentCodeName ?? ""
                byResource[detail.ResourceId ?? "", default: []].append((itemCategory(item), component.RealCost.flatMap(Double.init) ?? 0))
            }
        }
        let resources = byResource.map { id, rows in
            let usage = usageCosts(rows)
            return ResourceCost(resourceID: id, amount: usage.reduce(0) { $0 + $1.amount }, usage: usage)
        }
        .filter { abs($0.amount) >= 0.005 }
        .sorted { $0.amount > $1.amount }
        let usage = usageCosts(byResource.values.flatMap { $0 })
        return ServiceCostDetail(
            serviceName: product.serviceName,
            unit: "CNY",
            total: usage.reduce(0) { $0 + $1.amount },
            usage: usage,
            resources: resources,
            resourcesNote: (first.Total ?? 0) > maxPages * pageSize ? "Showing the first \(pages * pageSize) bill records." : nil
        )
    }

    /// Billing item names (e.g. 标准存储容量, 外网下行流量) folded into storage / data in /
    /// data out / requests; anything else keeps its own name.
    static func itemCategory(_ item: String) -> String {
        switch item {
        case _ where item.contains("下行") || item.contains("出流量") || item.contains("回源"): return "Data transfer out"
        case _ where item.contains("上行") || item.contains("入流量"): return "Data transfer in"
        case _ where item.contains("存储") || item.contains("容量"): return "Storage"
        case _ where item.contains("请求"): return "Requests"
        default: return item
        }
    }

    private static func usageCosts(_ rows: [(String, Double)]) -> [UsageCost] {
        Dictionary(rows, uniquingKeysWith: +)
            .filter { abs($0.value) >= 0.005 }
            .map { UsageCost(name: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }

    /// Tencent's `Balance` is in fen (1/100 CNY) — a prepaid-account concept AWS doesn't have.
    private static func accountBalance(credential: AWSSigV4Signer.Credential) async throws -> Double {
        struct Response: Decodable {
            struct Body: Decodable { let Balance: Int }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: host, service: service, action: "DescribeAccountBalance", version: version, payload: [:], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return Double(decoded.Response.Balance) / 100
    }

    private static var monthCalendar: Calendar {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        return utc
    }

    private static var dateTimeFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }

    private static var monthFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }
}
