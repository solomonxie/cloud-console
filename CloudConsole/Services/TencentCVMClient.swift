import Foundation

struct TencentCVMInstance: Identifiable, Hashable, Codable {
    var id: String { instanceId }
    let instanceId: String
    let instanceName: String
    let instanceType: String
    let state: String
}

/// Tencent CVM (Cloud Virtual Machine) — the EC2 equivalent. TC3-signed, region-specific
/// (default ap-guangzhou; no region picker in the app yet).
enum TencentCVMClient {
    static func listInstances(region: String = "ap-guangzhou", credential: AWSSigV4Signer.Credential) async throws -> [TencentCVMInstance] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Instance: Decodable {
                    let InstanceId: String
                    let InstanceName: String
                    let InstanceType: String
                    let InstanceState: String
                }
                let InstanceSet: [Instance]?
            }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: "cvm.tencentcloudapi.com", service: "cvm", action: "DescribeInstances", version: "2017-03-12", region: region, payload: [:], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.InstanceSet ?? []).map {
            TencentCVMInstance(instanceId: $0.InstanceId, instanceName: $0.InstanceName, instanceType: $0.InstanceType, state: $0.InstanceState)
        }
    }
}
