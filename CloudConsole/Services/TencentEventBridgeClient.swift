import Foundation

/// Tencent EventBridge (`eb`) — buses, rules and their targets. Timer-triggered rules are
/// ordinary rules here; Tencent has no separate scheduler product.
enum TencentEventBridgeClient {
    static let regions = ["ap-guangzhou", "ap-shanghai", "ap-beijing", "ap-hongkong", "ap-singapore"]

    static func listItems(credential: AWSSigV4Signer.Credential) async throws -> [EventBridgeItem] {
        var items: [EventBridgeItem] = []
        var firstError: Error?
        for region in regions {
            do { items += try await busesAndRules(region: region, credential: credential) } catch { firstError = firstError ?? error }
        }
        if items.isEmpty, let firstError { throw firstError }
        return items
    }

    static func detail(of item: EventBridgeItem, credential: AWSSigV4Signer.Credential) async throws -> EventBridgeDetail {
        switch item.kind {
        case .bus:
            let bus = try await busList(region: item.region, credential: credential).first { $0["EventBusId"] as? String == item.ref } ?? [:]
            return EventBridgeDetail(fields: fields([
                ("Name", bus["EventBusName"]), ("ID", bus["EventBusId"]), ("Description", bus["Description"]),
                ("Type", bus["Type"]), ("Created", bus["AddTime"]), ("Modified", bus["ModTime"]), ("Region", item.region),
            ]))
        case .rule, .schedule:
            let rule = try await call("GetRule", ["EventBusId": item.container, "RuleId": item.ref ?? ""], region: item.region, credential: credential)
            let targets = try await call("ListTargets", ["EventBusId": item.container, "RuleId": item.ref ?? ""], region: item.region, credential: credential)
            var detail = EventBridgeDetail(fields: fields([
                ("Name", rule["RuleName"]), ("ID", rule["RuleId"]), ("Event bus", item.container),
                ("State", enabled(rule)), ("Status", rule["Status"]), ("Description", rule["Description"]),
                ("Created", rule["AddTime"]), ("Modified", rule["ModTime"]), ("Region", item.region),
            ]))
            if let pattern = rule["EventPattern"] as? String { detail.documents.append(("Event pattern", JSONText.prettyString(pattern))) }
            for target in (targets["Targets"] as? [[String: Any]]) ?? [] {
                detail.documents.append(("Target · \(target["TargetId"] as? String ?? "?")", JSONText.pretty(target)))
            }
            return detail
        }
    }

    private static func busesAndRules(region: String, credential: AWSSigV4Signer.Credential) async throws -> [EventBridgeItem] {
        var items: [EventBridgeItem] = []
        for bus in try await busList(region: region, credential: credential) {
            guard let id = bus["EventBusId"] as? String, let name = bus["EventBusName"] as? String else { continue }
            let rules = ((try await call("ListRules", ["EventBusId": id, "Limit": 100], region: region, credential: credential))["Rules"] as? [[String: Any]]) ?? []
            if bus["Type"] as? String != "Cloud" || !rules.isEmpty {
                items.append(EventBridgeItem(kind: .bus, name: name, container: "", region: region, summary: bus["Description"] as? String, ref: id))
            }
            for rule in rules {
                guard let ruleName = rule["RuleName"] as? String else { continue }
                items.append(EventBridgeItem(kind: .rule, name: ruleName, container: id, region: region, state: enabled(rule), summary: rule["Description"] as? String, ref: rule["RuleId"] as? String))
            }
        }
        return items
    }

    private static func busList(region: String, credential: AWSSigV4Signer.Credential) async throws -> [[String: Any]] {
        let object = try await call("ListEventBuses", ["Limit": 100], region: region, credential: credential)
        return (object["EventBuses"] as? [[String: Any]]) ?? []
    }

    private static func enabled(_ rule: [String: Any]) -> String? {
        (rule["Enable"] as? Bool).map { $0 ? "ENABLED" : "DISABLED" }
    }

    private static func fields(_ pairs: [(String, Any?)]) -> [DetailField] {
        pairs.compactMap { label, value in
            guard let value, "\(value)" != "" else { return nil }
            return DetailField(label: label, value: "\(value)")
        }
    }

    private static func call(_ action: String, _ payload: [String: Any], region: String, credential: AWSSigV4Signer.Credential) async throws -> [String: Any] {
        let data = try await TencentAPIClient.request(host: "eb.tencentcloudapi.com", service: "eb", action: action, version: "2021-04-16", region: region, payload: payload, credential: credential)
        let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (envelope?["Response"] as? [String: Any]) ?? [:]
    }
}
