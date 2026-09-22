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
                struct Overview: Decodable { let BusinessCodeName: String; let RealTotalCost: String? }
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
                return ServiceCost(serviceName: item.BusinessCodeName, amount: amount)
            }
            .sorted { $0.amount > $1.amount }

        let month = monthFormatter.string(from: begin)
        return MonthToDateCost(periodStart: "\(month)-01", periodEnd: month, total: total, unit: "CNY", byService: byService, isEstimated: true)
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
