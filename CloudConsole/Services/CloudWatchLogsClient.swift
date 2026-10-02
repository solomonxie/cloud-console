import Foundation

struct LogEvent: Identifiable, Hashable, Codable {
    var id: String { "\(stream)/\(timestamp.timeIntervalSince1970)/\(message.hashValue)" }
    let timestamp: Date
    let message: String
    let stream: String
}

/// CloudWatch Logs — AWS JSON 1.1 protocol (POST + X-Amz-Target), region-specific.
enum CloudWatchLogsClient {
    struct NoLogGroup: LocalizedError {
        var errorDescription: String? { "No logs yet — the function hasn't run, or its role can't write logs." }
    }

    /// Lambda writes to `/aws/lambda/<function>` by default.
    static func lambdaLogGroup(_ function: String) -> String { "/aws/lambda/\(function)" }

    /// Events in `from...to`, oldest first, keeping only the newest `maxEvents`.
    static func events(logGroup: String, from: Date, to: Date, maxEvents: Int = 1000, region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> [LogEvent] {
        struct Response: Decodable {
            struct Event: Decodable {
                let timestamp: Double
                let message: String
                let logStreamName: String?
            }
            let events: [Event]?
            let nextToken: String?
        }
        var events: [LogEvent] = []
        var nextToken: String?
        // FilterLogEvents can return empty pages with a token; cap the round trips.
        for _ in 0..<20 {
            var body: [String: Any] = ["logGroupName": logGroup, "startTime": Int64(from.timeIntervalSince1970 * 1000), "endTime": Int64(to.timeIntervalSince1970 * 1000)]
            if let nextToken { body["nextToken"] = nextToken }
            let data: Data
            do {
                data = try await request(target: "FilterLogEvents", body: body, region: region, credential: credential)
            } catch let AWSQueryError.awsError(_, code, _) where code == "ResourceNotFoundException" {
                throw NoLogGroup()
            }
            let decoded = try JSONDecoder().decode(Response.self, from: data)
            events += (decoded.events ?? []).map {
                LogEvent(timestamp: Date(timeIntervalSince1970: $0.timestamp / 1000), message: $0.message.trimmingCharacters(in: .newlines), stream: $0.logStreamName ?? "")
            }
            if events.count > maxEvents { events.removeFirst(events.count - maxEvents) }
            nextToken = decoded.nextToken
            if nextToken == nil { break }
        }
        return events
    }

    private static func request(target: String, body: [String: Any], region: String, credential: AWSSigV4Signer.Credential) async throws -> Data {
        let payload = try JSONSerialization.data(withJSONObject: body)
        let url = URL(string: "https://logs.\(region).amazonaws.com/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = payload
        let headers = AWSSigV4Signer.headers(method: "POST", url: url, region: region, service: "logs", credential: credential, payload: payload, extraHeadersToSign: [
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "Logs_20140328.\(target)",
        ])
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: (response as? HTTPURLResponse)?.statusCode ?? -1, data: data)
        }
        return data
    }
}
