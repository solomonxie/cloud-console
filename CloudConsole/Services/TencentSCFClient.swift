import Foundation

struct TencentSCFFunction: Identifiable, Hashable, Codable {
    var id: String { functionName }
    let functionName: String
    let runtime: String
    let status: String
}

/// Tencent SCF (Serverless Cloud Function) — the Lambda equivalent. TC3-signed,
/// region-specific (default ap-guangzhou; no region picker in the app yet).
enum TencentSCFClient {
    static func listFunctions(region: String = "ap-guangzhou", credential: AWSSigV4Signer.Credential) async throws -> [TencentSCFFunction] {
        struct Response: Decodable {
            struct Body: Decodable {
                struct Fn: Decodable {
                    let FunctionName: String
                    let Runtime: String
                    let Status: String
                }
                let Functions: [Fn]?
            }
            let Response: Body
        }
        let data = try await TencentAPIClient.request(host: "scf.tencentcloudapi.com", service: "scf", action: "ListFunctions", version: "2018-04-16", region: region, payload: [:], credential: credential)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return (decoded.Response.Functions ?? []).map {
            TencentSCFFunction(functionName: $0.FunctionName, runtime: $0.Runtime, status: $0.Status)
        }
    }
}
