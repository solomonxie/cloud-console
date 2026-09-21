import Foundation

/// Just enough STS to sanity-check a key works, without requiring any
/// specific resource permission (unlike e.g. S3 ListBuckets).
enum STSClient {
    static func validate(credential: AWSSigV4Signer.Credential) async throws {
        var components = URLComponents(string: "https://sts.amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: "GetCallerIdentity"),
            URLQueryItem(name: "Version", value: "2011-06-15"),
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        let headers = AWSSigV4Signer.headers(method: "GET", url: components.url!, region: "us-east-1", service: "sts", credential: credential)
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw S3Error.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1, body)
        }
    }
}
