import Foundation

struct ServiceCost: Identifiable, Codable {
    var id: String { serviceName }
    let serviceName: String
    let amount: Double
}

struct MonthToDateCost: Identifiable, Codable {
    var id: String { periodStart }
    let periodStart: String
    let periodEnd: String
    let total: Double
    let unit: String
    let byService: [ServiceCost]
    let isEstimated: Bool
    /// Remaining prepaid balance, where the provider exposes one (Tencent does; AWS bills
    /// post-pay, so this stays nil there).
    var balance: Double? = nil
}

/// Minimal native Cost Explorer client — no AWS SDK. Unlike S3/IAM's query-string GET
/// APIs, Cost Explorer speaks the AWS JSON 1.1 protocol: POST with a JSON body and an
/// X-Amz-Target header naming the action. Cost Explorer is a global service reachable
/// only at the us-east-1 endpoint, same as IAM.
enum CostExplorerClient {
    static func monthToDateCost(credential: AWSSigV4Signer.Credential) async throws -> MonthToDateCost {
        let (start, end) = monthToDateRange()
        let results = try await getCostAndUsage(start: start, end: end, credential: credential)
        return results.first ?? MonthToDateCost(periodStart: start, periodEnd: end, total: 0, unit: "USD", byService: [], isEstimated: false)
    }

    /// Every month from `monthsBack` months ago through the current (in-progress) month, in
    /// one `GetCostAndUsage` call — MONTHLY granularity returns one `ResultsByTime` entry per
    /// month, so this doesn't cost 12 separate requests.
    static func monthlyBills(monthsBack: Int, credential: AWSSigV4Signer.Credential) async throws -> [MonthToDateCost] {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let now = Date()
        let currentMonthStart = utc.date(from: utc.dateComponents([.year, .month], from: now))!
        let rangeStart = utc.date(byAdding: .month, value: -monthsBack, to: currentMonthStart)!
        let endExclusive = utc.date(byAdding: .day, value: 1, to: now)!

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")

        let results = try await getCostAndUsage(start: formatter.string(from: rangeStart), end: formatter.string(from: endExclusive), credential: credential)
        return results.sorted { $0.periodStart > $1.periodStart }
    }

    private static func getCostAndUsage(start: String, end: String, credential: AWSSigV4Signer.Credential) async throws -> [MonthToDateCost] {
        let body: [String: Any] = [
            "TimePeriod": ["Start": start, "End": end],
            "Granularity": "MONTHLY",
            "Metrics": ["UnblendedCost"],
            "GroupBy": [["Type": "DIMENSION", "Key": "SERVICE"]],
        ]
        let payload = try JSONSerialization.data(withJSONObject: body)
        let url = URL(string: "https://ce.us-east-1.amazonaws.com/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = payload
        urlRequest.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("AWSInsightsIndexService.GetCostAndUsage", forHTTPHeaderField: "X-Amz-Target")
        let headers = AWSSigV4Signer.headers(method: "POST", url: url, region: "us-east-1", service: "ce", credential: credential, payload: payload)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw AWSQueryError.badResponse(-1, "No response")
        }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: http.statusCode, data: data)
        }
        return try parse(data)
    }

    /// Start of this UTC month through tomorrow (Cost Explorer's End is exclusive, so
    /// today's spend only shows up once End is at least tomorrow).
    private static func monthToDateRange() -> (start: String, end: String) {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let now = Date()
        let startOfMonth = utc.date(from: utc.dateComponents([.year, .month], from: now))!
        let endExclusive = utc.date(byAdding: .day, value: 1, to: now)!

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return (formatter.string(from: startOfMonth), formatter.string(from: endExclusive))
    }

    private static func parse(_ data: Data) throws -> [MonthToDateCost] {
        struct Response: Decodable {
            struct Metric: Decodable {
                let Amount: String
                let Unit: String
            }
            struct Group: Decodable {
                let Keys: [String]
                let Metrics: [String: Metric]
            }
            struct TimePeriod: Decodable {
                let Start: String
                let End: String
            }
            struct ResultByTime: Decodable {
                let TimePeriod: TimePeriod
                let Groups: [Group]
                let Estimated: Bool
            }
            let ResultsByTime: [ResultByTime]
        }
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return decoded.ResultsByTime.map { result in
            var byService: [ServiceCost] = []
            var total = 0.0
            var unit = "USD"
            for group in result.Groups {
                guard let name = group.Keys.first, let metric = group.Metrics["UnblendedCost"] else { continue }
                let amount = Double(metric.Amount) ?? 0
                unit = metric.Unit
                total += amount
                if amount > 0 {
                    byService.append(ServiceCost(serviceName: name, amount: amount))
                }
            }
            byService.sort { $0.amount > $1.amount }
            return MonthToDateCost(periodStart: result.TimePeriod.Start, periodEnd: result.TimePeriod.End, total: total, unit: unit, byService: byService, isEstimated: result.Estimated)
        }
    }
}
