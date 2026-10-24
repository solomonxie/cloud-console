import Foundation

struct ServiceCost: Identifiable, Codable {
    var id: String { serviceName }
    /// The provider's own name — also the filter key for drilling into it.
    let serviceName: String
    let amount: Double
    /// Provider product code, where filtering needs it instead of the name (Tencent).
    var code: String? = nil

    var displayName: String { shortServiceName(serviceName) }
}

struct UsageCost: Identifiable, Codable {
    var id: String { name }
    let name: String
    let amount: Double
}

struct ResourceCost: Identifiable, Codable {
    var id: String { resourceID }
    /// Empty for usage not tied to a resource.
    let resourceID: String
    let amount: Double
    let usage: [UsageCost]
}

/// One service's cost for one billing period, split by usage category and by resource.
struct ServiceCostDetail: Codable {
    let serviceName: String
    let unit: String
    let total: Double
    let usage: [UsageCost]
    let resources: [ResourceCost]
    /// The window `resources` covers — AWS keeps resource-level costs for 14 days only,
    /// so it can be shorter than the period.
    var resourcesFrom: String?
    var resourcesTo: String?
    /// Why `resources` is empty, when it couldn't be fetched.
    var resourcesNote: String?
}

private let shortServiceNames: [String: String] = [
    "Amazon Simple Storage Service": "S3",
    "Amazon Elastic Compute Cloud - Compute": "EC2",
    "EC2 - Other": "EC2 Other",
    "Amazon Relational Database Service": "RDS",
    "AWS Lambda": "Lambda",
    "Amazon Elastic Load Balancing": "ELB",
    "AWS Key Management Service": "KMS",
    "Amazon Virtual Private Cloud": "VPC",
    "Amazon Simple Notification Service": "SNS",
    "Amazon Simple Queue Service": "SQS",
    "Amazon Simple Email Service": "SES",
    "Amazon Elastic Container Service": "ECS",
    "Amazon Elastic Container Service for Kubernetes": "EKS",
    "Amazon EC2 Container Registry (ECR)": "ECR",
    "Amazon Elastic File System": "EFS",
    "Amazon Elastic Block Store": "EBS",
    "AmazonCloudWatch": "CloudWatch",
    "CloudWatch Events": "EventBridge",
    "Amazon OpenSearch Service": "OpenSearch",
    "Amazon Elastic MapReduce": "EMR",
]

/// "Amazon Simple Storage Service" → "S3", "AWS Secrets Manager" → "Secrets Manager",
/// "对象存储 COS" → "COS".
func shortServiceName(_ name: String) -> String {
    if let short = shortServiceNames[name] { return short }
    for prefix in ["Amazon ", "AWS "] where name.hasPrefix(prefix) {
        return String(name.dropFirst(prefix.count))
    }
    if let last = name.split(separator: " ").last, last.count < name.count, last.allSatisfy(\.isASCII) {
        return String(last)
    }
    return name
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

    /// One service's cost for a period (Cost Explorer `End` is exclusive), by usage category,
    /// plus a per-resource split over the part of the period inside AWS's 14-day window.
    /// The per-resource half needs "resource-level data" enabled in Cost Explorer; without
    /// it, the page still shows the category split.
    static func serviceDetail(service: String, start: String, end: String, credential: AWSSigV4Signer.Credential) async throws -> ServiceCostDetail {
        let filter: [String: Any] = ["Dimensions": ["Key": "SERVICE", "Values": [service]]]
        async let usageGroups = groupedCosts(target: "GetCostAndUsage", body: [
            "TimePeriod": ["Start": start, "End": end],
            "Granularity": "MONTHLY",
            "Metrics": ["UnblendedCost"],
            "Filter": filter,
            "GroupBy": [["Type": "DIMENSION", "Key": "USAGE_TYPE"]],
        ], credential: credential)

        var resources: [ResourceCost] = []
        var note: String?
        let window = resourceWindow(start: start, end: end)
        if let window {
            do {
                let groups = try await groupedCosts(target: "GetCostAndUsageWithResources", body: [
                    "TimePeriod": ["Start": window.start, "End": window.end],
                    "Granularity": "DAILY",
                    "Metrics": ["UnblendedCost"],
                    "Filter": filter,
                    "GroupBy": [["Type": "DIMENSION", "Key": "RESOURCE_ID"], ["Type": "DIMENSION", "Key": "USAGE_TYPE"]],
                ], credential: credential)
                let byResource = Dictionary(grouping: groups) { $0.keys.first ?? "" }
                resources = byResource.map { id, rows in
                    let usage = usageCosts(rows.map { (usageCategory($0.keys.last ?? ""), $0.amount) })
                    return ResourceCost(resourceID: id, amount: usage.reduce(0) { $0 + $1.amount }, usage: usage)
                }
                .filter { abs($0.amount) >= 0.005 }
                .sorted { $0.amount > $1.amount }
            } catch {
                note = "Per-resource costs need resource-level data turned on in Cost Explorer preferences. (\(error.localizedDescription))"
            }
        } else {
            note = "AWS keeps per-resource costs for the last 14 days only."
        }

        let groups = try await usageGroups
        let usage = usageCosts(groups.map { (usageCategory($0.keys.first ?? ""), $0.amount) })
        return ServiceCostDetail(
            serviceName: service,
            unit: groups.first?.unit ?? "USD",
            total: usage.reduce(0) { $0 + $1.amount },
            usage: usage,
            resources: resources,
            resourcesFrom: window?.start,
            resourcesTo: window.map { lastDay(before: $0.end) },
            resourcesNote: note
        )
    }

    /// Usage types grouped into the categories people think in — storage, requests, data
    /// in/out — keeping the rest under their region-less usage type.
    static func usageCategory(_ usageType: String) -> String {
        let type = usageType.replacing(/^(?:[A-Z]{2,4}\d|EU)-/, with: "")
        switch type {
        case _ where type.contains("Out-Bytes") || type.contains("DataTransfer-Out"): return "Data transfer out"
        case _ where type.contains("In-Bytes") || type.contains("DataTransfer-In"): return "Data transfer in"
        case _ where type.contains("DataTransfer-Regional"): return "Data transfer (regional)"
        case _ where type.contains("TimedStorage") || type.contains("TagStorage"): return "Storage"
        case _ where type.contains("Requests"): return "Requests"
        case _ where type.contains("Retrieval"): return "Retrieval"
        default: return type
        }
    }

    private static let namedCategories: Set<String> = ["Data transfer out", "Data transfer in", "Storage", "Requests"]

    /// Merged by name; zero rows kept only for the named categories (e.g. free ingress).
    private static func usageCosts(_ rows: [(String, Double)]) -> [UsageCost] {
        Dictionary(rows, uniquingKeysWith: +)
            .filter { abs($0.value) >= 0.005 || namedCategories.contains($0.key) }
            .map { UsageCost(name: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }

    /// The period clipped to the last 14 days (13 back, to stay clear of the edge); nil if
    /// the period ends before that.
    private static func resourceWindow(start: String, end: String) -> (start: String, end: String)? {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let today = utc.startOfDay(for: Date())
        let earliest = dayFormatter.string(from: utc.date(byAdding: .day, value: -13, to: today)!)
        let latest = dayFormatter.string(from: utc.date(byAdding: .day, value: 1, to: today)!)
        let clippedStart = max(start, earliest), clippedEnd = min(end, latest)
        return clippedStart < clippedEnd ? (clippedStart, clippedEnd) : nil
    }

    private static func lastDay(before exclusiveEnd: String) -> String {
        guard let date = dayFormatter.date(from: exclusiveEnd) else { return exclusiveEnd }
        return dayFormatter.string(from: date.addingTimeInterval(-86_400))
    }

    private static var dayFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }

    /// Every group across every time slice and page.
    private static func groupedCosts(target: String, body: [String: Any], credential: AWSSigV4Signer.Credential) async throws -> [(keys: [String], amount: Double, unit: String)] {
        struct Response: Decodable {
            struct Metric: Decodable { let Amount: String; let Unit: String }
            struct Group: Decodable { let Keys: [String]; let Metrics: [String: Metric] }
            struct ResultByTime: Decodable { let Groups: [Group] }
            let ResultsByTime: [ResultByTime]
            let NextPageToken: String?
        }
        var rows: [(keys: [String], amount: Double, unit: String)] = []
        var body = body
        for _ in 0..<20 {
            let decoded = try JSONDecoder().decode(Response.self, from: try await post(target: target, body: body, credential: credential))
            for group in decoded.ResultsByTime.flatMap(\.Groups) {
                guard let metric = group.Metrics["UnblendedCost"] else { continue }
                rows.append((group.Keys, Double(metric.Amount) ?? 0, metric.Unit))
            }
            guard let token = decoded.NextPageToken else { break }
            body["NextPageToken"] = token
        }
        return rows
    }

    private static func getCostAndUsage(start: String, end: String, credential: AWSSigV4Signer.Credential) async throws -> [MonthToDateCost] {
        let body: [String: Any] = [
            "TimePeriod": ["Start": start, "End": end],
            "Granularity": "MONTHLY",
            "Metrics": ["UnblendedCost"],
            "GroupBy": [["Type": "DIMENSION", "Key": "SERVICE"]],
        ]
        return try parse(try await post(target: "GetCostAndUsage", body: body, credential: credential))
    }

    private static func post(target: String, body: [String: Any], credential: AWSSigV4Signer.Credential) async throws -> Data {
        let payload = try JSONSerialization.data(withJSONObject: body)
        let url = URL(string: "https://ce.us-east-1.amazonaws.com/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = payload
        urlRequest.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("AWSInsightsIndexService.\(target)", forHTTPHeaderField: "X-Amz-Target")
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
        return data
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
