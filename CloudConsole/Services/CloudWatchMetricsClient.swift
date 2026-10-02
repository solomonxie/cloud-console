import Foundation

struct MetricPoint: Hashable {
    let time: Date
    let value: Double
}

/// A metric to fetch: either one CloudWatch metric, or a SEARCH expression (first match wins).
struct MetricQuery {
    let id: String
    let namespace: String
    let name: String
    let dimensions: [String: String]
    var stat = "Average"
    var search: String?
}

/// CloudWatch metrics — Query API (form POST, XML), region-specific.
enum CloudWatchMetricsClient {
    static func series(_ queries: [MetricQuery], from: Date, to: Date, period: Int, region: String, credential: AWSSigV4Signer.Credential) async throws -> [String: [MetricPoint]] {
        if AppData.isDemo { return DemoCloud.metrics(queries.map(\.id), from: from, to: to, period: period) }
        var params: [(String, String)] = [
            ("Action", "GetMetricData"),
            ("Version", "2010-08-01"),
            ("StartTime", iso(from)),
            ("EndTime", iso(to)),
            ("ScanBy", "TimestampAscending"),
        ]
        for (i, query) in queries.enumerated() {
            let p = "MetricDataQueries.member.\(i + 1)"
            params.append(("\(p).Id", query.id))
            if let search = query.search {
                params.append(("\(p).Expression", "SEARCH('\(search)', '\(query.stat)', \(period))"))
            } else {
                params += [
                    ("\(p).MetricStat.Metric.Namespace", query.namespace),
                    ("\(p).MetricStat.Metric.MetricName", query.name),
                    ("\(p).MetricStat.Period", String(period)),
                    ("\(p).MetricStat.Stat", query.stat),
                ]
                for (j, (name, value)) in query.dimensions.sorted(by: { $0.key < $1.key }).enumerated() {
                    params.append(("\(p).MetricStat.Metric.Dimensions.member.\(j + 1).Name", name))
                    params.append(("\(p).MetricStat.Metric.Dimensions.member.\(j + 1).Value", value))
                }
            }
        }
        let body = Data(params.map { "\(formEncode($0.0))=\(formEncode($0.1))" }.joined(separator: "&").utf8)
        let url = URL(string: "https://monitoring.\(region).amazonaws.com/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = body
        let contentType = "application/x-www-form-urlencoded; charset=utf-8"
        for (key, value) in AWSSigV4Signer.headers(method: "POST", url: url, region: region, service: "monitoring", credential: credential, payload: body, extraHeadersToSign: ["Content-Type": contentType]) {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200...299).contains(status) else { throw AWSQueryError.parse(status: status, data: data) }
        return parse(data)
    }

    private static func parse(_ data: Data) -> [String: [MetricPoint]] {
        let parser = XMLPathParser(data: data)
        var result: [String: [MetricPoint]] = [:]
        var id: String?
        var times: [Date] = []
        var values: [Double] = []
        parser.onEnd = { path, text in
            let parent = path.dropLast().last
            switch path.last {
            case "Id" where path.dropLast(2).last == "MetricDataResults":
                id = text
            case "member" where parent == "Timestamps":
                if let date = AWSDate.iso8601(text) { times.append(date) }
            case "member" where parent == "Values":
                if let value = Double(text) { values.append(value) }
            case "member" where parent == "MetricDataResults":
                // A SEARCH can match several series under one Id; keep the first.
                if let id, result[id] == nil {
                    result[id] = zip(times, values).map { MetricPoint(time: $0, value: $1) }.sorted { $0.time < $1.time }
                }
                id = nil
                times = []
                values = []
            default:
                break
            }
        }
        parser.run()
        return result
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func formEncode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")) ?? value
    }
}
