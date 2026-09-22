import Foundation

/// Tiny XMLParser wrapper that reports each element's close with its ancestor path and text.
/// Shared by every AWS query-API client (S3, IAM, ...) — they all return this XML shape.
final class XMLPathParser: NSObject, XMLParserDelegate {
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

enum AWSDate {
    static func iso8601(_ string: String) -> Date? {
        ISO8601DateFormatter().date(from: string) ?? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter.date(from: string)
        }()
    }
}

/// Shared AWS "query API" error shape (S3, IAM, STS all return this XML on failure).
enum AWSQueryError: LocalizedError {
    case awsError(status: Int, code: String, message: String)
    case badResponse(Int, String)

    var errorDescription: String? {
        switch self {
        case .awsError(_, let code, let message):
            return "\(code): \(message)"
        case .badResponse(let status, let message):
            return "AWS returned \(status): \(message)"
        }
    }

    static func parse(status: Int, data: Data) -> AWSQueryError {
        let parser = XMLPathParser(data: data)
        var code = ""
        var message = ""
        parser.onEnd = { path, text in
            switch path.last {
            case "Code": code = text
            case "Message": message = text
            default: break
            }
        }
        parser.run()
        guard !code.isEmpty else {
            return .badResponse(status, String(data: data, encoding: .utf8) ?? "")
        }
        return .awsError(status: status, code: code, message: message)
    }

    /// Error shape for AWS's JSON-protocol services (Cost Explorer, and others we may add
    /// later) — `{"__type": "SomeException", "message": "..."}` instead of the query APIs' XML.
    static func parseJSON(status: Int, data: Data) -> AWSQueryError {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return .badResponse(status, String(data: data, encoding: .utf8) ?? "")
        }
        let type = (object["__type"] as? String)?.split(separator: "#").last.map(String.init) ?? "Error"
        let message = (object["message"] as? String) ?? (object["Message"] as? String) ?? ""
        return .awsError(status: status, code: type, message: message)
    }
}
