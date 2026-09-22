import Foundation
import CryptoKit

/// Tencent COS client — object-storage REST API shaped almost identically to S3's (same
/// XML bodies, same list/delete/copy semantics), just signed with `COSSigner` instead of
/// SigV4. Reuses S3Client's `S3Bucket`/`S3Object`/`S3ListResult` — they're plain data shapes
/// with nothing S3-specific about them.
enum TencentCOSClient {
    static func listBuckets(credential: AWSSigV4Signer.Credential) async throws -> [S3Bucket] {
        let url = URL(string: "https://service.cos.myqcloud.com/")!
        let data = try await request(method: "GET", url: url, credential: credential)
        return parseListAllMyBuckets(data)
    }

    static func listObjects(bucket: String, region: String, prefix: String, credential: AWSSigV4Signer.Credential) async throws -> S3ListResult {
        var components = URLComponents(string: "https://\(bucket).cos.\(region).myqcloud.com/")!
        components.queryItems = [
            URLQueryItem(name: "list-type", value: "2"),
            URLQueryItem(name: "delimiter", value: "/"),
            URLQueryItem(name: "prefix", value: prefix),
        ]
        let data = try await request(method: "GET", url: components.url!, credential: credential)
        return parseListBucketResult(data)
    }

    static func listAllKeys(bucket: String, region: String, prefix: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        var keys: [String] = []
        var continuationToken: String?
        repeat {
            var components = URLComponents(string: "https://\(bucket).cos.\(region).myqcloud.com/")!
            var items = [
                URLQueryItem(name: "list-type", value: "2"),
                URLQueryItem(name: "prefix", value: prefix),
            ]
            if let continuationToken { items.append(URLQueryItem(name: "continuation-token", value: continuationToken)) }
            components.queryItems = items
            let data = try await request(method: "GET", url: components.url!, credential: credential)
            let page = parseKeysPage(data)
            keys.append(contentsOf: page.keys)
            continuationToken = page.nextToken
        } while continuationToken != nil
        return keys
    }

    static func presignedURL(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential, expiresIn: Int = 3600) -> URL {
        COSSigner.presignedURL(method: "GET", url: objectURL(bucket: bucket, region: region, key: key), credential: credential, expiresIn: expiresIn)
    }

    static func downloadObject(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) async throws -> Data {
        try await request(method: "GET", url: objectURL(bucket: bucket, region: region, key: key), credential: credential)
    }

    // MARK: Write operations — request builders only, executed via the shared background queue.

    static func deleteObjectRequest(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        signedRequest(method: "DELETE", url: objectURL(bucket: bucket, region: region, key: key), credential: credential)
    }

    static func copyObjectRequest(bucket: String, region: String, sourceKey: String, destKey: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        let copySource = "\(bucket).cos.\(region).myqcloud.com/\(pathEncode(sourceKey))"
        return signedRequest(method: "PUT", url: objectURL(bucket: bucket, region: region, key: destKey), credential: credential, extraHeaders: ["x-cos-copy-source": copySource])
    }

    static func batchDeleteRequest(bucket: String, region: String, keys: [String], credential: AWSSigV4Signer.Credential) -> (request: URLRequest, body: Data) {
        let objectsXML = keys.map { "<Object><Key>\(xmlEscape($0))</Key></Object>" }.joined()
        let body = Data("<Delete><Quiet>true</Quiet>\(objectsXML)</Delete>".utf8)
        let url = URL(string: "https://\(bucket).cos.\(region).myqcloud.com/?delete")!
        let md5Base64 = Data(Insecure.MD5.hash(data: body)).base64EncodedString()
        let request = signedRequest(method: "POST", url: url, credential: credential, extraHeaders: ["Content-MD5": md5Base64, "Content-Type": "application/xml"])
        return (request, body)
    }

    private static func signedRequest(method: String, url: URL, credential: AWSSigV4Signer.Credential, extraHeaders: [String: String] = [:]) -> URLRequest {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        for (key, value) in COSSigner.headers(method: method, url: url, credential: credential, extraHeadersToSign: extraHeaders) {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        return urlRequest
    }

    private static func request(method: String, url: URL, credential: AWSSigV4Signer.Credential) async throws -> Data {
        let urlRequest = signedRequest(method: method, url: url, credential: credential)
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return data }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parse(status: http.statusCode, data: data)
        }
        return data
    }

    private static func objectURL(bucket: String, region: String, key: String) -> URL {
        URL(string: "https://\(bucket).cos.\(region).myqcloud.com/\(pathEncode(key))")!
    }

    private static let pathAllowedCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~/")

    private static func pathEncode(_ key: String) -> String {
        key.addingPercentEncoding(withAllowedCharacters: pathAllowedCharacters) ?? key
    }

    private static func xmlEscape(_ string: String) -> String {
        string
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    // MARK: XML parsing — same shape as S3's responses.

    private static func parseListAllMyBuckets(_ data: Data) -> [S3Bucket] {
        let parser = XMLPathParser(data: data)
        var buckets: [S3Bucket] = []
        var currentName: String?
        var currentDate: String?
        var currentLocation: String?
        parser.onEnd = { path, text in
            switch path.last {
            case "Name" where path.dropLast().last == "Bucket":
                currentName = text
            case "CreateDate" where path.dropLast().last == "Bucket":
                currentDate = text
            case "Location" where path.dropLast().last == "Bucket":
                currentLocation = text
            case "Bucket":
                if let name = currentName {
                    buckets.append(S3Bucket(name: name, creationDate: currentDate.flatMap(AWSDate.iso8601), region: currentLocation))
                }
                currentName = nil
                currentDate = nil
                currentLocation = nil
            default:
                break
            }
        }
        parser.run()
        return buckets
    }

    private static func parseListBucketResult(_ data: Data) -> S3ListResult {
        let parser = XMLPathParser(data: data)
        var folders: [String] = []
        var objects: [S3Object] = []
        var currentKey: String?
        var currentSize: String?
        var currentModified: String?
        parser.onEnd = { path, text in
            switch path.last {
            case "Prefix" where path.dropLast().last == "CommonPrefixes":
                folders.append(text)
            case "Key" where path.dropLast().last == "Contents":
                currentKey = text
            case "Size" where path.dropLast().last == "Contents":
                currentSize = text
            case "LastModified" where path.dropLast().last == "Contents":
                currentModified = text
            case "Contents":
                if let key = currentKey, !key.hasSuffix("/") {
                    objects.append(S3Object(key: key, size: Int(currentSize ?? "") ?? 0, lastModified: currentModified.flatMap(AWSDate.iso8601)))
                }
                currentKey = nil
                currentSize = nil
                currentModified = nil
            default:
                break
            }
        }
        parser.run()
        return S3ListResult(folders: folders, objects: objects)
    }

    private static func parseKeysPage(_ data: Data) -> (keys: [String], nextToken: String?) {
        let parser = XMLPathParser(data: data)
        var keys: [String] = []
        var currentKey: String?
        var isTruncated = false
        var nextToken: String?
        parser.onEnd = { path, text in
            switch path.last {
            case "Key" where path.dropLast().last == "Contents":
                currentKey = text
            case "Contents":
                if let key = currentKey { keys.append(key) }
                currentKey = nil
            case "IsTruncated":
                isTruncated = (text == "true")
            case "NextContinuationToken":
                nextToken = text
            default:
                break
            }
        }
        parser.run()
        return (keys, isTruncated ? nextToken : nil)
    }
}
