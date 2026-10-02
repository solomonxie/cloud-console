import Foundation

/// Demo mode (Settings card): sample connections and resources from the bundled `demo/` folder.
/// No network, no Keychain, no resource cache, no writes to any account.
enum AppData {
    static let demoKey = "demo.on"
    /// Bumped by "Reset demo data", so the home page rebuilds from the preset.
    static let demoGenerationKey = "demo.generation"

    static var isDemo: Bool { UserDefaults.standard.bool(forKey: demoKey) }
}

enum StoreRegion: String {
    case us, cn
}

/// App Store region this install was built for (`make device STORE=cn`); `us` covers Canada/US.
/// TODO: gate vendors by region (e.g. hide Tencent/Alibaba outside cn, AWS/Azure/GCP in cn).
func storeRegion(_ bundle: Bundle = .main) -> StoreRegion {
    StoreRegion(rawValue: bundle.object(forInfoDictionaryKey: "AppStoreRegion") as? String ?? "") ?? .us
}

/// Fixture files: `connections.json`, plus one per vendor (`aws.json`, `tencent.json`) keyed by
/// the cache-key kind (`s3-buckets`, `iam-users`, `billing-mtd`, …). A demo connection's
/// credential carries its fixture name as the access key ID.
///
/// Relative dates: `"@today-3 10:00"` → Date, `"@ymd month-2"` → `yyyy-MM-dd` (first of the month),
/// `"@iso today-9 15:22"` → ISO 8601 string, and `{today-3}` inside a string → `yyyy-MM-dd`.
enum DemoCloud {
    struct Unavailable: LocalizedError {
        var errorDescription: String? { "Not available in demo mode." }
    }

    static func fixtureName(for vendor: CloudVendor) -> String { vendor == .tencent ? "tencent" : "aws" }

    static func credential(for vendor: CloudVendor) -> AWSSigV4Signer.Credential {
        AWSSigV4Signer.Credential(accessKeyID: fixtureName(for: vendor), secretAccessKey: "demo")
    }

    static func connections() -> [CloudConnection] {
        (try? decode([CloudConnection].self, load("connections") as Any)) ?? []
    }

    /// A list page's value by its cache key, `<kind>:<fixture>`.
    static func value<T: Decodable>(_ type: T.Type, cacheKey: String) throws -> T {
        let parts = cacheKey.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2, let json = fixture(parts[1])[parts[0]] else { throw Unavailable() }
        return try decode(T.self, json)
    }

    static func buckets(_ credential: AWSSigV4Signer.Credential) -> [S3Bucket] {
        let f = fixture(credential.accessKeyID)
        return ((try? decode([S3Bucket].self, f["s3-buckets"] ?? f["cos-buckets"] ?? [])) ?? []).sorted { $0.name < $1.name }
    }

    static func region(bucket: String) -> String {
        ["aws", "tencent"].lazy.flatMap { buckets(AWSSigV4Signer.Credential(accessKeyID: $0, secretAccessKey: "")) }
            .first { $0.name == bucket }?.region ?? "us-east-1"
    }

    static func objects(bucket: String, prefix: String, _ credential: AWSSigV4Signer.Credential) -> S3ListResult {
        let listing = ((fixture(credential.accessKeyID)["objects"] as? [String: Any])?[bucket] as? [String: Any])?[prefix]
        return listing.flatMap { try? decode(S3ListResult.self, $0) } ?? S3ListResult(folders: [], objects: [])
    }

    /// Preview bytes: a short text stand-in, since the objects don't exist anywhere.
    static func download(key: String) -> Data {
        Data("Demo file: \(key)\nSample content for demo mode — nothing was downloaded.\n".utf8)
    }

    static func attachedPolicies(_ principal: String, _ credential: AWSSigV4Signer.Credential) -> [IAMPolicyAttachment] {
        let rows = (policies(principal, credential)["attached"] as? [[String]]) ?? []
        return rows.filter { $0.count == 2 }.map { IAMPolicyAttachment(policyName: $0[0], policyArn: $0[1]) }
    }

    static func inlinePolicyNames(_ principal: String, _ credential: AWSSigV4Signer.Credential) -> [String] {
        (policies(principal, credential)["inline"] as? [String]) ?? []
    }

    /// CAM names principals by `uin/…` / `role/…`; mapped back to the user/role name.
    static func camPolicyNames(arn: String, _ credential: AWSSigV4Signer.Credential) -> [String] {
        let f = fixture(credential.accessKeyID)
        let principals = ((f["cam-users"] as? [[String: Any]]) ?? []) + ((f["cam-roles"] as? [[String: Any]]) ?? [])
        guard let match = principals.first(where: { $0["arn"] as? String == arn }),
              let name = (match["userName"] ?? match["roleName"]) as? String else { return [] }
        return attachedPolicies(name, credential).map(\.policyName)
    }

    static func policyDocument(_ nameOrArn: String, _ credential: AWSSigV4Signer.Credential) -> String {
        let documents = (fixture(credential.accessKeyID)["documents"] as? [String: Any]) ?? [:]
        let name = nameOrArn.split(separator: "/").last.map(String.init) ?? nameOrArn
        guard let document = documents[name] ?? documents["default"],
              let data = try? JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: Loading

    private static func policies(_ principal: String, _ credential: AWSSigV4Signer.Credential) -> [String: Any] {
        ((fixture(credential.accessKeyID)["policies"] as? [String: Any])?[principal] as? [String: Any]) ?? [:]
    }

    private static func fixture(_ name: String) -> [String: Any] {
        (load(name) as? [String: Any]) ?? [:]
    }

    private static func load(_ name: String, bundle: Bundle = .main, now: Date = .now) -> Any? {
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "demo"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return resolve(json, now: now)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ json: Any) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: json, options: .fragmentsAllowed))
    }

    static func resolve(_ value: Any, now: Date) -> Any {
        switch value {
        case let array as [Any]: return array.map { resolve($0, now: now) }
        case let object as [String: Any]: return object.mapValues { resolve($0, now: now) }
        case let text as String: return resolve(text, now: now)
        default: return value
        }
    }

    private static func resolve(_ text: String, now: Date) -> Any {
        if text.hasPrefix("@ymd "), let d = date(String(text.dropFirst(5)), now: now) { return ymd(d) }
        if text.hasPrefix("@iso "), let d = date(String(text.dropFirst(5)), now: now) {
            return formatter("yyyy-MM-dd'T'HH:mm:ss.SSSZ").string(from: d)
        }
        if text.hasPrefix("@"), let d = date(String(text.dropFirst()), now: now) { return d.timeIntervalSinceReferenceDate }
        guard text.contains("{") else { return text }
        return text.replacing(#/\{((?:today|month)(?:[+-]\d+)?)\}/#) { match in
            date(String(match.1), now: now).map(ymd) ?? String(match.0)
        }
    }

    /// `today±N[ HH:mm]` (days) or `month±N` (first day of that month).
    static func date(_ text: String, now: Date, calendar: Calendar = .current) -> Date? {
        guard let m = text.wholeMatch(of: #/(today|month)([+-]\d+)?(?: (\d{1,2}):(\d{2}))?/#) else { return nil }
        let amount = m.2.flatMap { Int($0) } ?? 0
        let start = calendar.startOfDay(for: now)
        let day: Date?
        if m.1 == "today" {
            day = calendar.date(byAdding: .day, value: amount, to: start)
        } else {
            day = calendar.date(byAdding: .month, value: amount, to: start)
                .flatMap { calendar.date(from: calendar.dateComponents([.year, .month], from: $0)) }
        }
        guard let day, let h = m.3.flatMap({ Int($0) }), let min = m.4.flatMap({ Int($0) }) else { return day }
        return calendar.date(bySettingHour: h, minute: min, second: 0, of: day)
    }

    private static func ymd(_ date: Date) -> String {
        formatter("yyyy-MM-dd").string(from: date)
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }
}
