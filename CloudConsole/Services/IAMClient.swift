import Foundation

struct IAMUser: Identifiable, Hashable, Codable {
    var id: String { arn }
    let userName: String
    let arn: String
    let path: String
    let createDate: Date?
}

struct IAMRole: Identifiable, Hashable, Codable {
    var id: String { arn }
    let roleName: String
    let arn: String
    let path: String
    let createDate: Date?

    /// Auto-created by AWS for a service or SSO — not something a user manages directly.
    var isServiceManaged: Bool {
        path.hasPrefix("/aws-service-role/") || path.hasPrefix("/aws-reserved/")
    }
}

struct IAMPolicyAttachment: Identifiable {
    var id: String { policyArn }
    let policyName: String
    let policyArn: String
}

/// Minimal native IAM client — no AWS SDK, just SigV4-signed Query API calls.
/// IAM is a global service: always signed with region "us-east-1".
enum IAMClient {
    static func listUsers(credential: AWSSigV4Signer.Credential) async throws -> [IAMUser] {
        let data = try await request(action: "ListUsers", credential: credential)
        return parseMembers(data, container: "Users") { fields in
            guard let name = fields["UserName"], let arn = fields["Arn"] else { return nil }
            return IAMUser(userName: name, arn: arn, path: fields["Path"] ?? "/", createDate: fields["CreateDate"].flatMap(AWSDate.iso8601))
        }
    }

    static func listRoles(credential: AWSSigV4Signer.Credential) async throws -> [IAMRole] {
        let data = try await request(action: "ListRoles", credential: credential)
        return parseMembers(data, container: "Roles") { fields in
            guard let name = fields["RoleName"], let arn = fields["Arn"] else { return nil }
            return IAMRole(roleName: name, arn: arn, path: fields["Path"] ?? "/", createDate: fields["CreateDate"].flatMap(AWSDate.iso8601))
        }
    }

    static func listAttachedUserPolicies(userName: String, credential: AWSSigV4Signer.Credential) async throws -> [IAMPolicyAttachment] {
        let data = try await request(action: "ListAttachedUserPolicies", parameters: ["UserName": userName], credential: credential)
        return parseMembers(data, container: "AttachedPolicies") { fields in
            guard let name = fields["PolicyName"], let arn = fields["PolicyArn"] else { return nil }
            return IAMPolicyAttachment(policyName: name, policyArn: arn)
        }
    }

    static func listUserPolicyNames(userName: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        let data = try await request(action: "ListUserPolicies", parameters: ["UserName": userName], credential: credential)
        return parseSimpleList(data, container: "PolicyNames")
    }

    static func listAttachedRolePolicies(roleName: String, credential: AWSSigV4Signer.Credential) async throws -> [IAMPolicyAttachment] {
        let data = try await request(action: "ListAttachedRolePolicies", parameters: ["RoleName": roleName], credential: credential)
        return parseMembers(data, container: "AttachedPolicies") { fields in
            guard let name = fields["PolicyName"], let arn = fields["PolicyArn"] else { return nil }
            return IAMPolicyAttachment(policyName: name, policyArn: arn)
        }
    }

    static func listRolePolicyNames(roleName: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        let data = try await request(action: "ListRolePolicies", parameters: ["RoleName": roleName], credential: credential)
        return parseSimpleList(data, container: "PolicyNames")
    }

    static func inlineUserPolicyDocument(userName: String, policyName: String, credential: AWSSigV4Signer.Credential) async throws -> String {
        let data = try await request(action: "GetUserPolicy", parameters: ["UserName": userName, "PolicyName": policyName], credential: credential)
        return decodedDocument(parseField(data, tag: "PolicyDocument"))
    }

    static func inlineRolePolicyDocument(roleName: String, policyName: String, credential: AWSSigV4Signer.Credential) async throws -> String {
        let data = try await request(action: "GetRolePolicy", parameters: ["RoleName": roleName, "PolicyName": policyName], credential: credential)
        return decodedDocument(parseField(data, tag: "PolicyDocument"))
    }

    /// Managed policies store their document on a version, not the policy itself —
    /// look up the default version, then fetch that version's document.
    static func attachedPolicyDocument(policyArn: String, credential: AWSSigV4Signer.Credential) async throws -> String {
        let policyData = try await request(action: "GetPolicy", parameters: ["PolicyArn": policyArn], credential: credential)
        guard let versionId = parseField(policyData, tag: "DefaultVersionId") else {
            throw AWSQueryError.badResponse(-1, "No default version for \(policyArn)")
        }
        let versionData = try await request(action: "GetPolicyVersion", parameters: ["PolicyArn": policyArn, "VersionId": versionId], credential: credential)
        return decodedDocument(parseField(versionData, tag: "Document"))
    }

    private static func decodedDocument(_ raw: String?) -> String {
        guard let raw else { return "" }
        return raw.removingPercentEncoding ?? raw
    }

    private static func request(action: String, parameters: [String: String] = [:], credential: AWSSigV4Signer.Credential) async throws -> Data {
        var components = URLComponents(string: "https://iam.amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: action),
            URLQueryItem(name: "Version", value: "2010-05-08"),
        ] + parameters.map { URLQueryItem(name: $0.key, value: $0.value) }
        let url = components.url!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        let headers = AWSSigV4Signer.headers(method: "GET", url: url, region: "us-east-1", service: "iam", credential: credential)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return data }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parse(status: http.statusCode, data: data)
        }
        return data
    }

    /// Generic `<Container><member>field, field, ...</member>...</Container>` parser — every
    /// IAM List* call returns this shape, just with different field names per resource.
    private static func parseMembers<T>(_ data: Data, container: String, build: @escaping ([String: String]) -> T?) -> [T] {
        let parser = XMLPathParser(data: data)
        var results: [T] = []
        var fields: [String: String] = [:]
        parser.onEnd = { path, text in
            guard path.count >= 3, path[path.count - 3] == container, path[path.count - 2] == "member" else {
                if path.last == "member", path.dropLast().last == container {
                    if let value = build(fields) { results.append(value) }
                    fields = [:]
                }
                return
            }
            fields[path.last!] = text
        }
        parser.run()
        return results
    }

    /// `<Container><member>value</member>...</Container>` — a flat string list, e.g. PolicyNames.
    private static func parseSimpleList(_ data: Data, container: String) -> [String] {
        let parser = XMLPathParser(data: data)
        var results: [String] = []
        parser.onEnd = { path, text in
            guard path.last == "member", path.dropLast().last == container else { return }
            results.append(text)
        }
        parser.run()
        return results
    }

    /// Grabs a single named tag's text anywhere in the response — for one-off result fields
    /// like GetUserPolicy's PolicyDocument or GetPolicy's DefaultVersionId.
    private static func parseField(_ data: Data, tag: String) -> String? {
        let parser = XMLPathParser(data: data)
        var value: String?
        parser.onEnd = { path, text in
            if path.last == tag { value = text }
        }
        parser.run()
        return value
    }
}
