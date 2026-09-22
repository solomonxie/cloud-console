import Foundation

/// Tencent CAM (Cloud Access Management) — the IAM equivalent. TC3-signed POST/JSON to
/// `cam.tencentcloudapi.com`. Reuses `IAMUser`/`IAMRole` (from IAMClient) as plain display
/// shapes — CAM has no literal ARN, so `arn` is a synthesized `uin/…` / `role/…` identifier.
///
/// Action and field names here match Tencent's published CAM docs as of this writing, but
/// this has never run against a real account — if a call 400s with an unfamiliar error code,
/// that's the first thing to check.
enum TencentCAMClient {
    private static let host = "cam.tencentcloudapi.com"
    private static let service = "cam"
    private static let version = "2019-01-16"

    static func listUsers(credential: AWSSigV4Signer.Credential) async throws -> [IAMUser] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct User: Decodable {
                    let Uin: Int
                    let Name: String
                    let CreateTime: String?
                }
                let Data: [User]?
            }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: host, service: service, action: "ListUsers", version: version, payload: [:], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.Data ?? []).map {
            IAMUser(userName: $0.Name, arn: "uin/\($0.Uin)", path: "/", createDate: $0.CreateTime.flatMap(TencentAPIClient.parseDate))
        }
    }

    static func listRoles(credential: AWSSigV4Signer.Credential) async throws -> [IAMRole] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Role: Decodable {
                    let RoleId: String
                    let RoleName: String
                    let AddTime: String?
                }
                let List: [Role]?
            }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: host, service: service, action: "DescribeRoleList", version: version, payload: ["Page": 1, "Rp": 200], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.List ?? []).map {
            IAMRole(roleName: $0.RoleName, arn: "role/\($0.RoleId)", path: "/", createDate: $0.AddTime.flatMap(TencentAPIClient.parseDate))
        }
    }

    /// `userArn` is the synthesized `uin/<n>` identifier `listUsers` put in `IAMUser.arn`.
    static func listAttachedUserPolicyNames(userArn: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Policy: Decodable { let PolicyName: String }
                let List: [Policy]?
            }
            let Response: Body
        }
        let uin = Int(userArn.split(separator: "/").last.map(String.init) ?? "") ?? 0
        let data = try await TencentAPIClient.request(host: host, service: service, action: "ListAttachedUserPolicies", version: version, payload: ["TargetUin": uin, "Page": 1, "Rp": 200], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.List ?? []).map(\.PolicyName)
    }

    /// `roleArn` is the synthesized `role/<id>` identifier `listRoles` put in `IAMRole.arn`.
    static func listAttachedRolePolicyNames(roleArn: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Policy: Decodable { let PolicyName: String }
                let List: [Policy]?
            }
            let Response: Body
        }
        let roleId = roleArn.split(separator: "/").last.map(String.init) ?? roleArn
        let data = try await TencentAPIClient.request(host: host, service: service, action: "ListAttachedRolePolicies", version: version, payload: ["RoleId": roleId, "Page": 1, "Rp": 200], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.List ?? []).map(\.PolicyName)
    }
}
