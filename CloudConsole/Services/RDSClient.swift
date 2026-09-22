import Foundation

struct RDSInstance: Identifiable, Hashable, Codable {
    var id: String { identifier }
    let identifier: String
    let engine: String
    let status: String
    let instanceClass: String
    let endpointAddress: String?
}

/// AWS RDS — Query API (XML), region-specific (default us-east-1; no region picker yet).
enum RDSClient {
    static func listInstances(region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> [RDSInstance] {
        var components = URLComponents(string: "https://rds.\(region).amazonaws.com/")!
        components.queryItems = [
            URLQueryItem(name: "Action", value: "DescribeDBInstances"),
            URLQueryItem(name: "Version", value: "2014-10-31"),
        ]
        let url = components.url!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        let headers = AWSSigV4Signer.headers(method: "GET", url: url, region: region, service: "rds", credential: credential)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { return [] }
        guard (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parse(status: http.statusCode, data: data)
        }
        return parseInstances(data)
    }

    private static func parseInstances(_ data: Data) -> [RDSInstance] {
        let parser = XMLPathParser(data: data)
        var instances: [RDSInstance] = []
        var identifier: String?
        var engine: String?
        var status: String?
        var instanceClass: String?
        var endpointAddress: String?

        parser.onEnd = { path, text in
            switch path.last {
            case "DBInstanceIdentifier":
                identifier = text
            case "Engine":
                engine = text
            case "DBInstanceStatus":
                status = text
            case "DBInstanceClass":
                instanceClass = text
            case "Address" where path.dropLast().last == "Endpoint":
                endpointAddress = text
            case "DBInstance":
                if let identifier {
                    instances.append(RDSInstance(identifier: identifier, engine: engine ?? "", status: status ?? "", instanceClass: instanceClass ?? "", endpointAddress: endpointAddress))
                }
                identifier = nil
                engine = nil
                status = nil
                instanceClass = nil
                endpointAddress = nil
            default:
                break
            }
        }
        parser.run()
        return instances
    }
}
