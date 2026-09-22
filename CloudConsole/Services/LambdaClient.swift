import Foundation

struct LambdaFunctionSummary: Identifiable, Hashable, Codable {
    var id: String { name }
    let name: String
    let runtime: String?
    let memorySize: Int?
    let lastModified: String?
}

/// AWS Lambda — plain REST/JSON (not the Query API), region-specific (default us-east-1).
enum LambdaClient {
    static func listFunctions(region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> [LambdaFunctionSummary] {
        let url = URL(string: "https://lambda.\(region).amazonaws.com/2015-03-31/functions/")!
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        let headers = AWSSigV4Signer.headers(method: "GET", url: url, region: region, service: "lambda", credential: credential)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: (response as? HTTPURLResponse)?.statusCode ?? -1, data: data)
        }
        struct Response: Decodable {
            struct Fn: Decodable {
                let FunctionName: String
                let Runtime: String?
                let MemorySize: Int?
                let LastModified: String?
            }
            let Functions: [Fn]
        }
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        return decoded.Functions.map { LambdaFunctionSummary(name: $0.FunctionName, runtime: $0.Runtime, memorySize: $0.MemorySize, lastModified: $0.LastModified) }
    }
}
