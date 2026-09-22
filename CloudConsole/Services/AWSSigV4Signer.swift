import Foundation
import CryptoKit

/// AWS Signature Version 4 — see docs.aws.amazon.com/general/latest/gr/sigv4-signing-process.html
enum AWSSigV4Signer {
    struct Credential: Hashable {
        let accessKeyID: String
        let secretAccessKey: String
        let sessionToken: String?

        init(accessKeyID: String, secretAccessKey: String, sessionToken: String? = nil) {
            self.accessKeyID = accessKeyID
            self.secretAccessKey = secretAccessKey
            self.sessionToken = sessionToken
        }
    }

    /// Returns headers to attach to the request (Authorization, x-amz-date, x-amz-content-sha256,
    /// host, [x-amz-security-token], plus any `extraHeadersToSign`).
    ///
    /// Any header the request actually carries — e.g. Content-Type or Content-MD5 on a batch
    /// delete — must be included here. S3 rejects a request with "There were headers present
    /// in the request which were not signed" if it sees a header that isn't in SignedHeaders.
    static func headers(
        method: String,
        url: URL,
        region: String,
        service: String,
        credential: Credential,
        payload: Data = Data(),
        extraHeadersToSign: [String: String] = [:],
        date: Date = Date()
    ) -> [String: String] {
        let amzDate = Self.amzDateFormatter.string(from: date)
        let dateStamp = Self.dateStampFormatter.string(from: date)
        let host = url.host ?? ""
        let payloadHash = sha256Hex(payload)

        var headersToSign = extraHeadersToSign.reduce(into: [String: String]()) { result, pair in
            result[pair.key.lowercased()] = pair.value
        }
        headersToSign["host"] = host
        headersToSign["x-amz-date"] = amzDate
        headersToSign["x-amz-content-sha256"] = payloadHash
        if let token = credential.sessionToken {
            headersToSign["x-amz-security-token"] = token
        }

        let sortedHeaderNames = headersToSign.keys.sorted()
        let canonicalHeaders = sortedHeaderNames.map { "\($0):\(headersToSign[$0]!.trimmingCharacters(in: .whitespaces))\n" }.joined()
        let signedHeaders = sortedHeaderNames.joined(separator: ";")

        let canonicalURI = canonicalPath(url)
        let canonicalQuery = canonicalQueryString(url)

        let canonicalRequest = [
            method,
            canonicalURI,
            canonicalQuery,
            canonicalHeaders,
            signedHeaders,
            payloadHash,
        ].joined(separator: "\n")

        let credentialScope = "\(dateStamp)/\(region)/\(service)/aws4_request"
        let stringToSign = [
            "AWS4-HMAC-SHA256",
            amzDate,
            credentialScope,
            sha256Hex(Data(canonicalRequest.utf8)),
        ].joined(separator: "\n")

        let signingKey = self.signingKey(secret: credential.secretAccessKey, dateStamp: dateStamp, region: region, service: service)
        let signature = hmacHex(key: signingKey, data: Data(stringToSign.utf8))

        let authorization = "AWS4-HMAC-SHA256 Credential=\(credential.accessKeyID)/\(credentialScope), SignedHeaders=\(signedHeaders), Signature=\(signature)"

        var result = headersToSign
        result["Authorization"] = authorization
        return result
    }

    /// A time-limited URL that needs no Authorization header — the signature lives in its
    /// query string instead, per SigV4's "presigned URL" variant. Good for sharing a link to
    /// a private object without changing the bucket's own permissions.
    static func presignedURL(
        method: String = "GET",
        url: URL,
        region: String,
        service: String,
        credential: Credential,
        expiresIn: Int = 3600,
        date: Date = Date()
    ) -> URL {
        let amzDate = Self.amzDateFormatter.string(from: date)
        let dateStamp = Self.dateStampFormatter.string(from: date)
        let credentialScope = "\(dateStamp)/\(region)/\(service)/aws4_request"
        let host = url.host ?? ""

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        var queryItems = components.queryItems ?? []
        queryItems.append(contentsOf: [
            URLQueryItem(name: "X-Amz-Algorithm", value: "AWS4-HMAC-SHA256"),
            URLQueryItem(name: "X-Amz-Credential", value: "\(credential.accessKeyID)/\(credentialScope)"),
            URLQueryItem(name: "X-Amz-Date", value: amzDate),
            URLQueryItem(name: "X-Amz-Expires", value: String(expiresIn)),
            URLQueryItem(name: "X-Amz-SignedHeaders", value: "host"),
        ])
        if let token = credential.sessionToken {
            queryItems.append(URLQueryItem(name: "X-Amz-Security-Token", value: token))
        }
        components.queryItems = queryItems
        let unsignedURL = components.url!

        let canonicalRequest = [
            method,
            canonicalPath(unsignedURL),
            canonicalQueryString(unsignedURL),
            "host:\(host)\n",
            "host",
            "UNSIGNED-PAYLOAD",
        ].joined(separator: "\n")

        let stringToSign = [
            "AWS4-HMAC-SHA256",
            amzDate,
            credentialScope,
            sha256Hex(Data(canonicalRequest.utf8)),
        ].joined(separator: "\n")

        let signingKey = self.signingKey(secret: credential.secretAccessKey, dateStamp: dateStamp, region: region, service: service)
        let signature = hmacHex(key: signingKey, data: Data(stringToSign.utf8))

        components.queryItems?.append(URLQueryItem(name: "X-Amz-Signature", value: signature))
        return components.url!
    }

    private static func signingKey(secret: String, dateStamp: String, region: String, service: String) -> SymmetricKey {
        let kDate = hmac(key: SymmetricKey(data: Data("AWS4\(secret)".utf8)), data: Data(dateStamp.utf8))
        let kRegion = hmac(key: SymmetricKey(data: kDate), data: Data(region.utf8))
        let kService = hmac(key: SymmetricKey(data: kRegion), data: Data(service.utf8))
        return SymmetricKey(data: hmac(key: SymmetricKey(data: kService), data: Data("aws4_request".utf8)))
    }

    private static func hmac(key: SymmetricKey, data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: key))
    }

    private static func hmacHex(key: SymmetricKey, data: Data) -> String {
        hmac(key: key, data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func canonicalPath(_ url: URL) -> String {
        let path = url.path.isEmpty ? "/" : url.path
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        let encoded = segments.map { uriEncode(String($0), encodeSlash: true) }
        return encoded.joined(separator: "/")
    }

    private static func canonicalQueryString(_ url: URL) -> String {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems, !items.isEmpty else { return "" }
        var pairs: [(String, String)] = []
        for item in items {
            let key = uriEncode(item.name, encodeSlash: true)
            let value = uriEncode(item.value ?? "", encodeSlash: true)
            pairs.append((key, value))
        }
        pairs.sort { lhs, rhs in
            lhs.0 == rhs.0 ? lhs.1 < rhs.1 : lhs.0 < rhs.0
        }
        return pairs.map { "\($0.0)=\($0.1)" }.joined(separator: "&")
    }

    private static func uriEncode(_ value: String, encodeSlash: Bool) -> String {
        var allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")
        if !encodeSlash { allowed.insert(charactersIn: "/") }
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static var amzDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static var dateStampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()
}
