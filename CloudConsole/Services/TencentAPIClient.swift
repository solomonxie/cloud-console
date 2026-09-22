import Foundation

enum TencentAPIError: LocalizedError {
    case api(code: String, message: String)
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .api(let code, let message): return "\(code): \(message)"
        case .badResponse(let message): return message
        }
    }

    static func parse(data: Data) -> TencentAPIError {
        if let envelope = try? JSONDecoder().decode(TencentErrorEnvelope.self, from: data), let error = envelope.Response.Error {
            return .api(code: error.Code, message: error.Message)
        }
        return .badResponse(String(data: data, encoding: .utf8) ?? "Request failed")
    }
}

struct TencentErrorEnvelope: Decodable {
    struct Body: Decodable {
        struct APIError: Decodable { let Code: String; let Message: String }
        let Error: APIError?
    }
    let Response: Body
}

/// Shared POST-JSON request helper for Tencent's API 3.0 services (CAM, Billing, and any
/// future ones) — TC3-signed. Tencent's convention is to always return HTTP 200, even for
/// API errors, so every call also checks the JSON body for `Response.Error`.
enum TencentAPIClient {
    static func request(host: String, service: String, action: String, version: String, region: String? = nil, payload: [String: Any], credential: AWSSigV4Signer.Credential) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: payload)
        let url = URL(string: "https://\(host)/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = body
        for (key, value) in TC3Signer.headers(host: host, service: service, action: action, version: version, region: region, payload: body, credential: credential) {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw TencentAPIError.parse(data: data)
        }
        if let envelope = try? JSONDecoder().decode(TencentErrorEnvelope.self, from: data), let error = envelope.Response.Error {
            throw TencentAPIError.api(code: error.Code, message: error.Message)
        }
        return data
    }

    static func parseDate(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.date(from: string)
    }
}
