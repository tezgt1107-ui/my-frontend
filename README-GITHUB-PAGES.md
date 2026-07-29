# DevPilot 靜態版

`docs` 資料夾是不需要 ASP.NET Core 的 GitHub Pages 版本。

在 GitHub repository 的 Settings → Pages → Source 選擇 **GitHub Actions**，推送到 `main` 後會自動部署。

Excel 產生與圖片 OCR 都在瀏覽器端執行；Excel 使用 SheetJS CDN，OCR 使用 Tesseract.js CDN。資料不會送到 DevPilot 伺服器。
