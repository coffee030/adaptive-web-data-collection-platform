[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ApiBase,
    [PSCredential]$Credential,
    [switch]$AllowBudgetEdits
)

$ErrorActionPreference = 'Stop'
if ($ApiBase -cnotmatch '^http://(?:127\.0\.0\.1|\[::1\]):[0-9]{1,5}/api/v1/?$') {
    throw 'Use the local Harbourline API address from diagnostics, including /api/v1.'
}
$endpoint = [Uri]($ApiBase.TrimEnd('/') + '/marketing/companies/session')
if ($endpoint.Port -lt 1) { throw 'Choose a valid local API port.' }
if (-not $Credential) {
    $Credential = Get-Credential -Message 'Sign in to the company you want to use from this MCP host.'
}
if (-not $Credential) { throw 'Company sign-in was cancelled.' }

Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseProxy = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(15)
try {
    if ($env:FYP_MCP_API_BASE -eq $ApiBase.TrimEnd('/') -and $env:HARBOURLINE_MCP_SESSION) {
        $cookie = [Net.Cookie]::new('harbourline_company_session', $env:HARBOURLINE_MCP_SESSION, '/api/v1/marketing')
        $handler.CookieContainer.Add($endpoint, $cookie)
    }
    foreach ($name in 'HARBOURLINE_MCP_SESSION','HARBOURLINE_MCP_COMPANY_ID','HARBOURLINE_MCP_ALLOW_BUDGET_EDITS','HARBOURLINE_MCP_WORKSPACE') {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $login = @{
        username = $Credential.UserName
        password = $Credential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    $body = [Net.Http.StringContent]::new($login, [Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync($endpoint, $body).GetAwaiter().GetResult()
    if ([int]$response.StatusCode -ne 200) {
        throw ('Company sign-in failed (HTTP {0}). Check the local deployment and your account.' -f [int]$response.StatusCode)
    }
    $identity = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    $cookie = $handler.CookieContainer.GetCookies($endpoint)['harbourline_company_session']
    if (-not $cookie -or $cookie.Value -cnotmatch '^[A-Za-z0-9_-]{43}$' -or $identity.id -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') {
        throw 'The local API did not issue a company session.'
    }
    $env:FYP_MCP_API_BASE = $ApiBase.TrimEnd('/')
    $env:HARBOURLINE_MCP_SESSION = $cookie.Value
    $env:HARBOURLINE_MCP_COMPANY_ID = $identity.id
    $env:HARBOURLINE_MCP_WORKSPACE = 'company'
    $env:HARBOURLINE_MCP_ALLOW_BUDGET_EDITS = if ($AllowBudgetEdits) { '1' } else { '0' }
    Write-Host ('Connected to {0} as {1}. Start the trusted MCP host in this terminal.' -f $identity.name,$identity.username)
}
finally {
    if ($response) { $response.Dispose() }
    if ($body) { $body.Dispose() }
    $client.Dispose()
    $login = $null
}
