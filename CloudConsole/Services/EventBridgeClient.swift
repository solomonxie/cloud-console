import Foundation

struct EventBridgeItem: Identifiable, Hashable, Codable {
    enum Kind: String, Codable {
        case rule = "Rule"
        case schedule = "Schedule"
        case bus = "Event bus"

        var icon: String {
            switch self {
            case .rule: return "arrow.triangle.branch"
            case .schedule: return "clock.fill"
            case .bus: return "tray.full.fill"
            }
        }
    }

    var id: String { [kind.rawValue, region, container, name].joined(separator: "|") }
    let kind: Kind
    let name: String
    /// Event bus (rules) or schedule group (schedules).
    let container: String
    let region: String
    var state: String?
    var summary: String?
    /// Provider-side identifier needed by detail calls where the name isn't enough.
    var ref: String?
}

struct EventBridgeDetail {
    var fields: [DetailField] = []
    var documents: [(title: String, text: String)] = []
}

enum JSONText {
    static func pretty(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return "\(object)" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Re-indents a JSON string field (event patterns, policies); passes other text through.
    static func prettyString(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) else { return raw }
        return pretty(object)
    }
}

/// EventBridge rules and buses (AWS JSON 1.1, `events`) plus EventBridge Scheduler
/// schedules (REST/JSON, `scheduler`). Both are regional.
enum EventBridgeClient {
    static func listItems(region: String, credential: AWSSigV4Signer.Credential) async throws -> [EventBridgeItem] {
        var items: [EventBridgeItem] = []
        var firstError: Error?
        do { items += try await busesAndRules(region: region, credential: credential) } catch { firstError = error }
        do { items += try await schedules(region: region, credential: credential) } catch { firstError = firstError ?? error; if items.isEmpty { throw error } }
        if items.isEmpty, let firstError { throw firstError }
        return items
    }

    static func detail(of item: EventBridgeItem, credential: AWSSigV4Signer.Credential) async throws -> EventBridgeDetail {
        switch item.kind {
        case .rule: return try await ruleDetail(item, credential: credential)
        case .schedule: return try await scheduleDetail(item, credential: credential)
        case .bus: return try await busDetail(item, credential: credential)
        }
    }

    private static func busesAndRules(region: String, credential: AWSSigV4Signer.Credential) async throws -> [EventBridgeItem] {
        var items: [EventBridgeItem] = []
        for bus in try await paged(target: "ListEventBuses", key: "EventBuses", body: [:], region: region, credential: credential) {
            guard let busName = bus["Name"] as? String else { continue }
            let rules = try await paged(target: "ListRules", key: "Rules", body: ["EventBusName": busName], region: region, credential: credential)
            if busName != "default" || !rules.isEmpty {
                items.append(EventBridgeItem(kind: .bus, name: busName, container: "", region: region, summary: bus["Description"] as? String, ref: bus["Arn"] as? String))
            }
            for rule in rules {
                guard let name = rule["Name"] as? String else { continue }
                let summary = (rule["ScheduleExpression"] as? String) ?? (rule["EventPattern"] != nil ? "Event pattern" : nil)
                items.append(EventBridgeItem(kind: .rule, name: name, container: busName, region: region, state: rule["State"] as? String, summary: summary, ref: rule["Arn"] as? String))
            }
        }
        return items
    }

    private static func schedules(region: String, credential: AWSSigV4Signer.Credential) async throws -> [EventBridgeItem] {
        var items: [EventBridgeItem] = []
        var token: String?
        repeat {
            var components = URLComponents(string: "https://scheduler.\(region).amazonaws.com/schedules")!
            if let token { components.queryItems = [URLQueryItem(name: "NextToken", value: token)] }
            let object = try await scheduler(url: components.url!, region: region, credential: credential)
            for schedule in (object["Schedules"] as? [[String: Any]]) ?? [] {
                guard let name = schedule["Name"] as? String else { continue }
                let target = (schedule["Target"] as? [String: Any])?["Arn"] as? String
                items.append(EventBridgeItem(kind: .schedule, name: name, container: (schedule["GroupName"] as? String) ?? "default", region: region, state: schedule["State"] as? String, summary: target?.split(separator: ":").last.map(String.init), ref: schedule["Arn"] as? String))
            }
            token = object["NextToken"] as? String
        } while token != nil
        return items
    }

    private static func ruleDetail(_ item: EventBridgeItem, credential: AWSSigV4Signer.Credential) async throws -> EventBridgeDetail {
        let rule = try await call("DescribeRule", body: ["Name": item.name, "EventBusName": item.container], region: item.region, credential: credential)
        let targets = try await paged(target: "ListTargetsByRule", key: "Targets", body: ["Rule": item.name, "EventBusName": item.container], region: item.region, credential: credential)
        var detail = EventBridgeDetail(fields: fields([
            ("Name", rule["Name"]), ("Event bus", rule["EventBusName"]), ("State", rule["State"]),
            ("Schedule", rule["ScheduleExpression"]), ("Description", rule["Description"]),
            ("Managed by", rule["ManagedBy"]), ("Role", rule["RoleArn"]), ("ARN", rule["Arn"]), ("Region", item.region),
        ]))
        if let pattern = rule["EventPattern"] as? String { detail.documents.append(("Event pattern", JSONText.prettyString(pattern))) }
        for target in targets {
            detail.documents.append(("Target · \(target["Id"] as? String ?? "?")", JSONText.pretty(target)))
        }
        return detail
    }

    private static func scheduleDetail(_ item: EventBridgeItem, credential: AWSSigV4Signer.Credential) async throws -> EventBridgeDetail {
        var components = URLComponents(string: "https://scheduler.\(item.region).amazonaws.com/schedules/\(item.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? item.name)")!
        components.queryItems = [URLQueryItem(name: "groupName", value: item.container)]
        let schedule = try await scheduler(url: components.url!, region: item.region, credential: credential)
        let target = schedule["Target"] as? [String: Any]
        let window = schedule["FlexibleTimeWindow"] as? [String: Any]
        var detail = EventBridgeDetail(fields: fields([
            ("Name", schedule["Name"]), ("Group", schedule["GroupName"]), ("State", schedule["State"]),
            ("Expression", schedule["ScheduleExpression"]), ("Time zone", schedule["ScheduleExpressionTimezone"]),
            ("Start", date(schedule["StartDate"])), ("End", date(schedule["EndDate"])), ("Created", date(schedule["CreationDate"])), ("Modified", date(schedule["LastModificationDate"])), ("Description", schedule["Description"]),
            ("Target", target?["Arn"]), ("Role", target?["RoleArn"]), ("Flexible window", window?["Mode"]),
            ("After completion", schedule["ActionAfterCompletion"]), ("ARN", schedule["Arn"]), ("Region", item.region),
        ]))
        if let target { detail.documents.append(("Target", JSONText.pretty(target))) }
        return detail
    }

    private static func busDetail(_ item: EventBridgeItem, credential: AWSSigV4Signer.Credential) async throws -> EventBridgeDetail {
        let bus = try await call("DescribeEventBus", body: ["Name": item.name], region: item.region, credential: credential)
        var detail = EventBridgeDetail(fields: fields([("Name", bus["Name"]), ("Description", bus["Description"]), ("ARN", bus["Arn"]), ("Region", item.region)]))
        if let policy = bus["Policy"] as? String { detail.documents.append(("Policy", JSONText.prettyString(policy))) }
        return detail
    }

    private static func date(_ epoch: Any?) -> String? {
        (epoch as? Double).map { Date(timeIntervalSince1970: $0).formatted(date: .abbreviated, time: .shortened) }
    }

    private static func fields(_ pairs: [(String, Any?)]) -> [DetailField] {
        pairs.compactMap { label, value in
            guard let value, "\(value)" != "" else { return nil }
            return DetailField(label: label, value: "\(value)")
        }
    }

    private static func paged(target: String, key: String, body: [String: Any], region: String, credential: AWSSigV4Signer.Credential) async throws -> [[String: Any]] {
        var all: [[String: Any]] = []
        var token: String?
        repeat {
            var request = body
            if let token { request["NextToken"] = token }
            let object = try await call(target, body: request, region: region, credential: credential)
            all += (object[key] as? [[String: Any]]) ?? []
            token = object["NextToken"] as? String
        } while token != nil
        return all
    }

    private static func call(_ target: String, body: [String: Any], region: String, credential: AWSSigV4Signer.Credential) async throws -> [String: Any] {
        let payload = try JSONSerialization.data(withJSONObject: body)
        let url = URL(string: "https://events.\(region).amazonaws.com/")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = payload
        request.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        request.setValue("AWSEvents.\(target)", forHTTPHeaderField: "X-Amz-Target")
        for (key, value) in AWSSigV4Signer.headers(method: "POST", url: url, region: region, service: "events", credential: credential, payload: payload) {
            request.setValue(value, forHTTPHeaderField: key)
        }
        return try await send(request)
    }

    private static func scheduler(url: URL, region: String, credential: AWSSigV4Signer.Credential) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        for (key, value) in AWSSigV4Signer.headers(method: "GET", url: url, region: region, service: "scheduler", credential: credential) {
            request.setValue(value, forHTTPHeaderField: key)
        }
        return try await send(request)
    }

    private static func send(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: (response as? HTTPURLResponse)?.statusCode ?? -1, data: data)
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
