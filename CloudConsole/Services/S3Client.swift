import Foundation

struct S3Bucket: Identifiable {
    var id: String { name }
    let name: String
    let creationDate: Date?
    var region: String?
}

struct S3Object: Identifiable {
    var id: String { key }
    let key: String
    let size: Int
    let lastModified: Date?
}

struct S3ListResult {
    let folders: [String]
    let objects: [S3Object]
}

enum S3Error: LocalizedError {
    case awsError(status: Int, code: String, message: String)
    case badResponse(Int, String)
    case decodingFailed

    var errorDescription: String? {
        switch self {
        case .awsError(_, let code, let message):
            return "\(code): \(message)"
        case .badResponse(let status, let message):
            return "S3 returned \(status): \(message)"
        case .decodingFailed:
            return "Couldn't parse S3's response."
        }
    }
}

/// Minimal native S3 client — no AWS SDK, just SigV4-signed REST calls.
enum S3Client {
    static func listBuckets(credential: AWSSigV4Signer.Credential) async throws -> [S3Bucket] {
        let url = URL(string: "https://s3.amazonaws.com/")!
        let data = try await request(method: "GET", url: url, region: "us-east-1", credential: credential)
        return parseListAllMyBuckets(data)
    }

    static func bucketRegion(name: String, credential: AWSSigV4Signer.Credential) async throws -> String {
        var components = URLComponents(string: "https://s3.amazonaws.com/\(name)")!
        components.queryItems = [URLQueryItem(name: "location", value: nil)]
        let data = try await request(method: "GET", url: components.url!, region: "us-east-1", credential: credential)
        let region = parseLocationConstraint(data)
        return region.isEmpty ? "us-east-1" : region
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

    private static func request(method: String, url: URL, region: String, credential: AWSSigV4Signer.Credential) async throws -> Data {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        let headers = AWSSigV4Signer.headers(method: method, url: url, region: region, service: "s3", credential: credential)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return data }
        guard (200...299).contains(http.statusCode) else {
            throw parseError(status: http.statusCode, data: data)
        }
        return data
    }

    // MARK: XML parsing

    private static func parseError(status: Int, data: Data) -> S3Error {
        let parser = XMLPathParser(data: data)
        var code = ""
        var message = ""
        parser.onEnd = { path, text in
            switch path.last {
            case "Code" where path.count == 2: code = text
            case "Message" where path.count == 2: message = text
            default: break
            }
        }
        parser.run()
        guard !code.isEmpty else {
            return .badResponse(status, String(data: data, encoding: .utf8) ?? "")
        }
        return .awsError(status: status, code: code, message: message)
    }

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
                    buckets.append(S3Bucket(name: name, creationDate: currentDate.flatMap(iso8601)))
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

    private static func parseLocationConstraint(_ data: Data) -> String {
        let parser = XMLPathParser(data: data)
        var region = ""
        parser.onEnd = { path, text in
            if path.last == "LocationConstraint" { region = text }
        }
        parser.run()
        return region
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
                    objects.append(S3Object(key: key, size: Int(currentSize ?? "") ?? 0, lastModified: currentModified.flatMap(iso8601)))
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

    private static func iso8601(_ string: String) -> Date? {
        ISO8601DateFormatter().date(from: string) ?? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter.date(from: string)
        }()
    }
}

/// Tiny XMLParser wrapper that reports each element's close with its ancestor path and text.
private final class XMLPathParser: NSObject, XMLParserDelegate {
    private let parser: XMLParser
    private var path: [String] = []
    private var text = ""
    var onEnd: (([String], String) -> Void)?

    init(data: Data) {
        parser = XMLParser(data: data)
        super.init()
        parser.delegate = self
    }

    func run() {
        parser.parse()
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        path.append(elementName)
        text = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        text += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        onEnd?(path, text.trimmingCharacters(in: .whitespacesAndNewlines))
        path.removeLast()
        text = ""
    }
}
