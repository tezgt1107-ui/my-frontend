# DevPilot

以 ASP.NET Core MVC 製作的工程師日常工作台。所有目前提供的資料轉換工具均在瀏覽器端執行，不會將輸入內容送至伺服器。

## 目前工具

- JSON 格式化、壓縮、驗證、轉 C# Model
- SQL IN 產生器
- 文字批次處理
- Unix Timestamp／ISO／UTC 轉換
- JWT 解碼器
- Base64、URL Encode／Decode、SHA-256
- Regex 即時測試與取代
- 文字逐行 Diff
- GUID 與安全密碼產生
- 抽籤轉盤
- 深色／淺色模式、Ctrl+K 工具搜尋

## 執行需求

- .NET 10 SDK
- Visual Studio 2026，或支援 .NET 10 的 Visual Studio / Rider / VS Code

## 啟動

```bash
dotnet restore
dotnet run
```

瀏覽器開啟 `http://localhost:5186`。

## 專案結構

```text
Controllers/       MVC Controllers
Views/             Razor Views
wwwroot/css/       UI 樣式
wwwroot/js/        共用與工具 JavaScript
```

## 安全提醒

JWT 解碼不等於簽章驗證；Base64 也不是加密。正式環境部署 API Proxy 或 AI 功能前，請加入身分驗證、權限、SSRF 防護、輸入大小限制及稽核政策。
