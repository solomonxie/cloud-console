import Foundation

struct LambdaFunctionSummary: Identifiable, Hashable, Codable {
    var id: String { name }
    let name: String
    let runtime: String?
    let memorySize: Int?
    let lastModified: String?
    var arn: String?
    var handler: String?
    var timeout: Int?
    var codeSize: Int?
    var description: String?
}

/// Result of a synchronous run.
struct LambdaInvocation: Hashable {
    let isError: Bool
    let status: String
    let response: String
    let log: String?
    var requestID: String?
}

/// AWS Lambda — plain REST/JSON (not the Query API), region-specific (default us-east-1).
enum LambdaClient {
    static func listFunctions(region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> [LambdaFunctionSummary] {
        struct Response: Decodable {
            struct Fn: Decodable {
                let FunctionName: String
                let FunctionArn: String?
                let Runtime: String?
                let Handler: String?
                let MemorySize: Int?
                let Timeout: Int?
                let CodeSize: Int?
                let Description: String?
                let LastModified: String?
            }
            let Functions: [Fn]
            let NextMarker: String?
        }
        var functions: [LambdaFunctionSummary] = []
        var marker: String?
        repeat {
            var components = URLComponents(string: "https://lambda.\(region).amazonaws.com/2015-03-31/functions/")!
            if let marker { components.queryItems = [URLQueryItem(name: "Marker", value: marker)] }
            let (data, _) = try await send(method: "GET", url: components.url!, region: region, credential: credential)
            let decoded = try JSONDecoder().decode(Response.self, from: data)
            functions += decoded.Functions.map {
                LambdaFunctionSummary(
                    name: $0.FunctionName, runtime: $0.Runtime, memorySize: $0.MemorySize, lastModified: $0.LastModified,
                    arn: $0.FunctionArn, handler: $0.Handler, timeout: $0.Timeout, codeSize: $0.CodeSize, description: $0.Description
                )
            }
            marker = decoded.NextMarker
        } while marker != nil
        return functions
    }

    /// Synchronous (RequestResponse) invoke with the last 4 KB of the log.
    static func invoke(name: String, payload: Data, region: String = "us-east-1", credential: AWSSigV4Signer.Credential) async throws -> LambdaInvocation {
        if AppData.isDemo { return DemoCloud.invoke(function: name, payload: payload) }
        let path = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let url = URL(string: "https://lambda.\(region).amazonaws.com/2015-03-31/functions/\(path)/invocations")!
        let (data, http) = try await send(method: "POST", url: url, region: region, credential: credential, payload: payload, headers: [
            "Content-Type": "application/json",
            "X-Amz-Invocation-Type": "RequestResponse",
            "X-Amz-Log-Type": "Tail",
        ])
        let functionError = http.value(forHTTPHeaderField: "X-Amz-Function-Error")
        let log = http.value(forHTTPHeaderField: "X-Amz-Log-Result")
            .flatMap { Data(base64Encoded: $0) }
            .map { String(decoding: $0, as: UTF8.self) }
        return LambdaInvocation(
            isError: functionError != nil,
            status: functionError.map { "Error · \($0)" } ?? "Succeeded · \(http.statusCode)",
            response: String(decoding: data, as: UTF8.self),
            log: log,
            requestID: http.value(forHTTPHeaderField: "x-amzn-RequestId")
        )
    }

    private static func send(method: String, url: URL, region: String, credential: AWSSigV4Signer.Credential, payload: Data = Data(), headers extra: [String: String] = [:]) async throws -> (Data, HTTPURLResponse) {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        if !payload.isEmpty { urlRequest.httpBody = payload }
        let headers = AWSSigV4Signer.headers(method: method, url: url, region: region, service: "lambda", credential: credential, payload: payload, extraHeadersToSign: extra)
        for (key, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AWSQueryError.parseJSON(status: (response as? HTTPURLResponse)?.statusCode ?? -1, data: data)
        }
        return (data, http)
    }
}
