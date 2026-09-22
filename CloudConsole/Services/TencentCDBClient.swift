import Foundation

struct TencentCDBInstance: Identifiable, Hashable, Codable {
    var id: String { instanceId }
    let instanceId: String
    let instanceName: String
    /// Tencent returns this as a numeric status code (docs list it, but the exact
    /// name→meaning mapping isn't verified here) — shown as-is rather than guessed at.
    let statusCode: Int
    let engineVersion: String?
}

/// Tencent CDB (Cloud Database, managed MySQL) — the RDS equivalent. TC3-signed,
/// region-specific (default ap-guangzhou; no region picker in the app yet).
enum TencentCDBClient {
    static func listInstances(region: String = "ap-guangzhou", credential: AWSSigV4Signer.Credential) async throws -> [TencentCDBInstance] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Item: Decodable {
                    let InstanceId: String
                    let InstanceName: String
                    let Status: Int
                    let EngineVersion: String?
                }
                let Items: [Item]?
            }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: "cdb.tencentcloudapi.com", service: "cdb", action: "DescribeDBInstances", version: "2017-03-20", region: region, payload: [:], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.Items ?? []).map {
            TencentCDBInstance(instanceId: $0.InstanceId, instanceName: $0.InstanceName, statusCode: $0.Status, engineVersion: $0.EngineVersion)
        }
    }
}
