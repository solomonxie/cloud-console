import Foundation

/// Tencent's STS GetCallerIdentity — sanity-checks a key without requiring any resource permission.
enum TencentSTSClient {
    static func validate(credential: AWSSigV4Signer.Credential) async throws {
        if AppData.isDemo { return }
        do {
            _ = try await TencentAPIClient.request(host: "sts.tencentcloudapi.com", service: "sts", action: "GetCallerIdentity", version: "2018-08-13", region: "ap-guangzhou", payload: [:], credential: credential)
        } catch TencentAPIError.api(let code, _) where code.hasPrefix("UnauthorizedOperation") {
            // Signature accepted; the key just isn't allowed this call.
        }
    }
}
