import Foundation
import CryptoKit

struct S3Bucket: Identifiable, Codable {
    var id: String { name }
    let name: String
    let creationDate: Date?
    var region: String?
}

struct S3Object: Identifiable, Codable {
    var id: String { key }
    let key: String
    let size: Int
    let lastModified: Date?
}

struct S3ListResult: Codable {
    var folders: [String]
    var objects: [S3Object]
}

/// Minimal native S3 client — no AWS SDK, just SigV4-signed REST calls.
enum S3Client {
    static func listBuckets(credential: AWSSigV4Signer.Credential) async throws -> [S3Bucket] {
        let url = URL(string: "https://s3.amazonaws.com/")!
        let data = try await request(method: "GET", url: url, region: "us-east-1", credential: credential)
        return parseListAllMyBuckets(data)
    }

    /// Unauthenticated HEAD, reading the `x-amz-bucket-region` response header — works even
    /// when the key has no `s3:GetBucketLocation` permission, unlike a signed GetBucketLocation call.
    static func bucketRegion(name: String) async throws -> String {
        let url = URL(string: "https://\(name).s3.amazonaws.com/")!
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              let region = http.value(forHTTPHeaderField: "x-amz-bucket-region"), !region.isEmpty else {
            return "us-east-1"
        }
        return region
    }

    static func listObjects(bucket: String, region: String, prefix: String, credential: AWSSigV4Signer.Credential) async throws -> S3ListResult {
        var components = URLComponents(string: "https://\(bucket).s3.\(region).amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "list-type", value: "2"),
            URLQueryItem(name: "delimiter", value: "/"),
            URLQueryItem(name: "prefix", value: prefix),
        ]
        let data = try await request(method: "GET", url: components.url!, region: region, credential: credential)
        return parseListBucketResult(data)
    }

    /// Every key under `prefix`, ignoring the folder delimiter — used to expand a folder
    /// into the flat list of objects a delete/copy/rename actually has to touch.
    static func listAllKeys(bucket: String, region: String, prefix: String, credential: AWSSigV4Signer.Credential) async throws -> [String] {
        var keys: [String] = []
        var continuationToken: String?
        repeat {
            var components = URLComponents(string: "https://\(bucket).s3.\(region).amazonaws.com/")!
            var items = [
                URLQueryItem(name: "list-type", value: "2"),
                URLQueryItem(name: "prefix", value: prefix),
            ]
            if let continuationToken { items.append(URLQueryItem(name: "continuation-token", value: continuationToken)) }
            components.queryItems = items
            let data = try await request(method: "GET", url: components.url!, region: region, credential: credential)
            let page = parseKeysPage(data)
            keys.append(contentsOf: page.keys)
            continuationToken = page.nextToken
        } while continuationToken != nil
        return keys
    }

    /// A time-limited link to an object — usable by anyone, without touching the bucket's
    /// own permissions. Good for both "share this file" and downloading a preview copy.
    static func presignedURL(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential, expiresIn: Int = 3600) -> URL {
        AWSSigV4Signer.presignedURL(method: "GET", url: objectURL(bucket: bucket, region: region, key: key), region: region, service: "s3", credential: credential, expiresIn: expiresIn)
    }

    /// Downloads an object's bytes for local preview (QuickLook). Fine for the sizes a
    /// person would actually want to preview in-app; not meant for bulk transfer.
    static func downloadObject(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) async throws -> Data {
        try await request(method: "GET", url: objectURL(bucket: bucket, region: region, key: key), region: region, credential: credential)
    }

    // MARK: Write operations — request builders only. Execution is via a background
    // URLSession (see S3OperationQueue) so deletes/copies/renames survive backgrounding.

    static func deleteObjectRequest(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        signedRequest(method: "DELETE", url: objectURL(bucket: bucket, region: region, key: key), region: region, credential: credential)
    }

    /// `destBucket`/`destRegion` may differ from the source — S3's CopyObject works across
    /// buckets (even across regions, within the same partition) as long as `x-amz-copy-source`
    /// names the source and the request itself is signed for the destination's region.
    static func copyObjectRequest(sourceBucket: String, sourceKey: String, destBucket: String, destRegion: String, destKey: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        let copySource = "/\(sourceBucket)/\(pathEncode(sourceKey))"
        return signedRequest(
            method: "PUT", url: objectURL(bucket: destBucket, region: destRegion, key: destKey), region: destRegion, credential: credential,
            extraHeaders: ["x-amz-copy-source": copySource]
        )
    }

    static func putObjectRequest(bucket: String, region: String, key: String, contentType: String?, credential: AWSSigV4Signer.Credential, body: Data) -> URLRequest {
        var extraHeaders: [String: String] = [:]
        if let contentType { extraHeaders["Content-Type"] = contentType }
        return signedRequest(method: "PUT", url: objectURL(bucket: bucket, region: region, key: key), region: region, credential: credential, body: body, extraHeaders: extraHeaders)
    }

    /// The object's ETag (unquoted), or nil if it doesn't exist — nil on any other failure too,
    /// since "unknown" should never block an upload, only a confirmed content match should.
    /// For a single-PUT object (never multipart, which is all this app ever writes), S3's ETag
    /// is just the object's raw MD5 hex, so it doubles as a cheap "is this the same file?" check.
    static func headObjectETag(bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) async -> String? {
        let request = signedRequest(method: "HEAD", url: objectURL(bucket: bucket, region: region, key: key), region: region, credential: credential)
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let etag = http.value(forHTTPHeaderField: "ETag") else { return nil }
        return etag.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }

    /// Batch-deletes up to 1000 keys in one call — S3's `POST /?delete` API.
    static func batchDeleteRequest(bucket: String, region: String, keys: [String], credential: AWSSigV4Signer.Credential) -> (request: URLRequest, body: Data) {
        let objectsXML = keys.map { "<Object><Key>\(xmlEscape($0))</Key></Object>" }.joined()
        let body = Data("<Delete><Quiet>true</Quiet>\(objectsXML)</Delete>".utf8)
        let url = URL(string: "https://\(bucket).s3.\(region).amazonaws.com/?delete")!
        let md5Base64 = Data(Insecure.MD5.hash(data: body)).base64EncodedString()
        let request = signedRequest(
            method: "POST", url: url, region: region, credential: credential, body: body,
            extraHeaders: ["Content-MD5": md5Base64, "Content-Type": "application/xml"]
        )
        return (request, body)
    }

    /// Builds a fully SigV4-signed request, without attaching a body — background-session
    /// uploads must supply the body separately via `uploadTask(with:from:)`.
    private static func signedRequest(method: String, url: URL, region: String, credential: AWSSigV4Signer.Credential, body: Data = Data(), extraHeaders: [String: String] = [:]) -> URLRequest {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        let headers = AWSSigV4Signer.headers(method: method, url: url, region: region, service: "s3", credential: credential, payload: body, extraHeadersToSign: extraHeaders)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        return urlRequest
    }

    private static func request(method: String, url: URL, region: String, credential: AWSSigV4Signer.Credential) async throws -> Data {
        let urlRequest = signedRequest(method: method, url: url, region: region, credential: credential)
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return data }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parse(status: http.statusCode, data: data)
        }
        return data
    }

    private static func objectURL(bucket: String, region: String, key: String) -> URL {
        URL(string: "https://\(bucket).s3.\(region).amazonaws.com/\(pathEncode(key))")!
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

    // MARK: XML parsing

    private static func parseListAllMyBuckets(_ data: Data) -> [S3Bucket] {
        let parser = XMLPathParser(data: data)
        var buckets: [S3Bucket] = []
        var currentName: String?
        var currentDate: String?
        parser.onEnd = { path, text in
            switch path.last {
            case "Name" where path.dropLast().last == "Bucket":
                currentName = text
            case "CreationDate" where path.dropLast().last == "Bucket":
                currentDate = text
            case "Bucket":
                if let name = currentName {
                    buckets.append(S3Bucket(name: name, creationDate: currentDate.flatMap(AWSDate.iso8601)))
                }
                currentName = nil
                currentDate = nil
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
