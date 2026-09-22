import Foundation
import CryptoKit

/// Tencent COS's own request-signing scheme (signature v5, HMAC-SHA1) — not SigV4 and not
/// TC3; COS predates Tencent's unified API 3.0 signer and keeps its own.
enum COSSigner {
    /// `extraHeadersToSign` are any headers the request actually carries beyond the
    /// Authorization itself (e.g. Content-Type/Content-MD5 on a batch delete) — COS, like S3,
    /// rejects a request that has a header present but not covered by `q-header-list`.
    static func headers(method: String, url: URL, credential: AWSSigV4Signer.Credential, extraHeadersToSign: [String: String] = [:], date: Date = Date(), validFor: Int = 3600) -> [String: String] {
        let authorization = authorization(method: method, url: url, credential: credential, extraHeadersToSign: extraHeadersToSign, date: date, validFor: validFor)
        var result = extraHeadersToSign
        result["Authorization"] = authorization
        if let token = credential.sessionToken { result["x-cos-security-token"] = token }
        return result
    }

    /// Query-string variant for a shareable link — same signature, carried as `sign=` instead
    /// of an `Authorization` header.
    static func presignedURL(method: String = "GET", url: URL, credential: AWSSigV4Signer.Credential, expiresIn: Int = 3600, date: Date = Date()) -> URL {
        let authorization = authorization(method: method, url: url, credential: credential, extraHeadersToSign: [:], date: date, validFor: expiresIn)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "sign", value: authorization))
        if let token = credential.sessionToken {
            items.append(URLQueryItem(name: "x-cos-security-token", value: token))
        }
        components.queryItems = items
        return components.url!
    }

    private static func authorization(method: String, url: URL, credential: AWSSigV4Signer.Credential, extraHeadersToSign: [String: String], date: Date, validFor: Int) -> String {
        let start = Int(date.timeIntervalSince1970)
        let end = start + validFor
        let keyTime = "\(start);\(end)"

        let signKey = hmacSHA1Hex(key: credential.secretAccessKey, data: keyTime)

        let path = canonicalPath(url)
        let queryPairs = sortedLowercasedPairs(from: URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
        let queryString = queryPairs.map { "\($0.0)=\($0.1)" }.joined(separator: "&")
        let paramNames = queryPairs.map { $0.0 }.joined(separator: ";")

        let headerPairs = sortedLowercasedPairs(from: extraHeadersToSign.map { URLQueryItem(name: $0.key, value: $0.value) })
        let headerString = headerPairs.map { "\($0.0)=\($0.1)" }.joined(separator: "&")
        let headerNames = headerPairs.map { $0.0 }.joined(separator: ";")

        let httpString = "\(method.lowercased())\n\(path)\n\(queryString)\n\(headerString)\n"
        let hashedHttpString = SHA1.hash(data: Data(httpString.utf8)).map { String(format: "%02x", $0) }.joined()
        let stringToSign = "sha1\n\(keyTime)\n\(hashedHttpString)\n"
        let signature = hmacSHA1Hex(key: signKey, data: stringToSign)

        return [
            "q-sign-algorithm=sha1",
            "q-ak=\(credential.accessKeyID)",
            "q-sign-time=\(keyTime)",
            "q-key-time=\(keyTime)",
            "q-header-list=\(headerNames)",
            "q-url-param-list=\(paramNames)",
            "q-signature=\(signature)",
        ].joined(separator: "&")
    }

    /// `url.path` comes back percent-decoded from Foundation — re-encode each segment so a
    /// key with reserved characters (spaces, `+`, `#`, …) signs the same way it's transmitted.
    private static func canonicalPath(_ url: URL) -> String {
        let path = url.path.isEmpty ? "/" : url.path
        return path.split(separator: "/", omittingEmptySubsequences: false)
            .map { $0.addingPercentEncoding(withAllowedCharacters: strictAllowedCharacters) ?? String($0) }
            .joined(separator: "/")
    }

    /// COS (like S3) wants *strict* percent-encoding here — only unreserved characters left
    /// bare. `.urlQueryAllowed` is too permissive (leaves `/` etc. unescaped), which silently
    /// produced a wrong signature for any request with query params (e.g. listing a folder).
    private static let strictAllowedCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")

    private static func sortedLowercasedPairs(from items: [URLQueryItem]) -> [(String, String)] {
        items
            .map { ($0.name.lowercased(), ($0.value ?? "").addingPercentEncoding(withAllowedCharacters: strictAllowedCharacters) ?? "") }
            .sorted { $0.0 == $1.0 ? $0.1 < $1.1 : $0.0 < $1.0 }
    }

    private static func hmacSHA1Hex(key: String, data: String) -> String {
        HMAC<Insecure.SHA1>.authenticationCode(for: Data(data.utf8), using: SymmetricKey(data: Data(key.utf8)))
            .map { String(format: "%02x", $0) }.joined()
    }
}

private typealias SHA1 = Insecure.SHA1
