import Foundation

/// Metadata only — values are fetched on the detail page and never cached.
struct SSMParameter: Identifiable, Hashable, Codable {
    var id: String { "\(region)|\(name)" }
    let name: String
    let region: String
    let type: String
    var tier: String?
    var version: Int?
    var lastModified: Date?
    var lastModifiedUser: String?
    var description: String?
    var dataType: String?
    var keyID: String?

    var isSecure: Bool { type == "SecureString" }

    var detailFields: [DetailField] {
        let pairs: [(String, String?)] = [
            ("Name", name), ("Type", type), ("Data type", dataType), ("Tier", tier),
            ("Version", version.map(String.init)),
            ("Modified", lastModified?.formatted(date: .abbreviated, time: .shortened)),
            ("Modified by", lastModifiedUser), ("Description", description), ("KMS key", keyID), ("Region", region),
        ]
        return pairs.compactMap { label, value in
            guard let value, !value.isEmpty else { return nil }
            return DetailField(label: label, value: value)
        }
    }
}

/// SSM Parameter Store (AWS JSON 1.1, `ssm`). Regional.
enum ParameterStoreClient {
    static func listParameters(region: String, credential: AWSSigV4Signer.Credential) async throws -> [SSMParameter] {
        var all: [SSMParameter] = []
        var token: String?
        repeat {
            var body: [String: Any] = ["MaxResults": 50]
            if let token { body["NextToken"] = token }
            let object = try await call("DescribeParameters", body: body, region: region, credential: credential)
            for p in (object["Parameters"] as? [[String: Any]]) ?? [] {
                guard let name = p["Name"] as? String else { continue }
                all.append(SSMParameter(
                    name: name, region: region, type: (p["Type"] as? String) ?? "String",
                    tier: p["Tier"] as? String, version: p["Version"] as? Int,
                    lastModified: (p["LastModifiedDate"] as? Double).map { Date(timeIntervalSince1970: $0) },
                    lastModifiedUser: p["LastModifiedUser"] as? String, description: p["Description"] as? String,
                    dataType: p["DataType"] as? String, keyID: p["KeyId"] as? String
                ))
            }
            token = object["NextToken"] as? String
        } while token != nil
        return all.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func value(of parameter: SSMParameter, decrypt: Bool, credential: AWSSigV4Signer.Credential) async throws -> String {
        if AppData.isDemo { return DemoCloud.parameterValue(parameter.name, credential) }
        let object = try await call("GetParameter", body: ["Name": parameter.name, "WithDecryption": decrypt], region: parameter.region, credential: credential)
        return ((object["Parameter"] as? [String: Any])?["Value"] as? String) ?? ""
    }

    private static func call(_ target: String, body: [String: Any], region: String, credential: AWSSigV4Signer.Credential) async throws -> [String: Any] {
        let payload = try JSONSerialization.data(withJSONObject: body)
        let url = URL(string: "https://ssm.\(region).amazonaws.com/")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = payload
        request.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        request.setValue("AmazonSSM.\(target)", forHTTPHeaderField: "X-Amz-Target")
        for (key, value) in AWSSigV4Signer.headers(method: "POST", url: url, region: region, service: "ssm", credential: credential, payload: payload) {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: (response as? HTTPURLResponse)?.statusCode ?? -1, data: data)
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
