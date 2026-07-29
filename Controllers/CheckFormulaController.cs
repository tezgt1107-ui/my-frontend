using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using DevPilot.Models;
using Microsoft.AspNetCore.Mvc;

namespace DevPilot.Controllers;

[ApiController]
[Route("api/check-formula")]
public sealed class CheckFormulaController(IWebHostEnvironment environment) : ControllerBase
{
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Xml = XNamespace.Xml;

    [HttpPost("generate")]
    public IActionResult Generate([FromBody] CheckFormulaRequest request)
    {
        if (request.SelfChecks.Count + request.CrossChecks.Count == 0)
            return BadRequest(new { message = "至少需要一筆檢核公式。" });
        if (request.SelfChecks.Count + request.CrossChecks.Count > 500)
            return BadRequest(new { message = "單次最多產生 500 筆檢核公式。" });

        var templateId = request.TemplateId switch
        {
            "EximAPI2CBC" => "EximAPI2CBC",
            "EximAPI2Jcic" => "EximAPI2Jcic",
            _ => ""
        };
        if (templateId.Length == 0)
            return BadRequest(new { message = "不支援的 Excel 樣板。" });
        var path = Path.Combine(environment.ContentRootPath, "Templates", templateId, "CheckTemplet.xlsx");
        if (!System.IO.File.Exists(path)) return Problem("找不到 CheckTemplet.xlsx 範本。");
        using var output = CreateExpandableStream(path);
        using (var archive = new ZipArchive(output, ZipArchiveMode.Update, leaveOpen: true))
        {
            if (templateId == "EximAPI2Jcic") UpdateJcicSheet(archive, request);
            else UpdateCbcSheet(archive, request);
        }
        var stamp = DateTime.Now.ToString("yyyyMMddHHmmss");
        return File(output.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"{templateId}_CheckFormula_{stamp}.xlsx");
    }

    private static void UpdateCbcSheet(ZipArchive archive, CheckFormulaRequest request)
    {
        var document = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var root = document.Root!;
        var sheetData = root.Element(S + "sheetData")!;
        sheetData.Elements(S + "row").Where(row => ((int?)row.Attribute("r") ?? 0) >= 4).Remove();
        root.Element(S + "mergeCells")?.Remove();

        var rowNumber = 4;
        var merges = new List<string>();
        foreach (var item in request.SelfChecks)
        {
            var start = rowNumber;
            sheetData.Add(DataRow(rowNumber++, item, selfCheck: true));
            if (!string.IsNullOrWhiteSpace(item.Note))
            {
                sheetData.Add(NoteRow(rowNumber++, item.Note));
                merges.Add($"A{start}:A{rowNumber - 1}");
                merges.Add($"B{start}:B{rowNumber - 1}");
            }
        }

        rowNumber += 2;
        sheetData.Add(SectionRow(rowNumber++, "二、跨表檢核"));
        sheetData.Add(HeaderRow(rowNumber++));
        foreach (var item in request.CrossChecks)
            sheetData.Add(DataRow(rowNumber++, item, selfCheck: false));

        if (merges.Count > 0)
        {
            var mergeCells = new XElement(S + "mergeCells", new XAttribute("count", merges.Count));
            merges.ForEach(reference => mergeCells.Add(new XElement(S + "mergeCell", new XAttribute("ref", reference))));
            sheetData.AddAfterSelf(mergeCells);
        }
        root.Element(S + "dimension")?.SetAttributeValue("ref", $"A1:E{rowNumber - 1}");
        WriteXml(archive, "xl/worksheets/sheet1.xml", document);
    }

    private static void UpdateJcicSheet(ZipArchive archive, CheckFormulaRequest request)
    {
        var document = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var root = document.Root!;
        var sheetData = root.Element(S + "sheetData")!;
        sheetData.Elements(S + "row").Where(row => ((int?)row.Attribute("r") ?? 0) >= 2).Remove();
        var rowNumber = 2;
        foreach (var item in request.SelfChecks)
            sheetData.Add(JcicRow(rowNumber++, 1, item));
        foreach (var item in request.CrossChecks)
            sheetData.Add(JcicRow(rowNumber++, 2, item));
        root.Element(S + "dimension")?.SetAttributeValue("ref", $"A1:D{Math.Max(1, rowNumber - 1)}");
        WriteXml(archive, "xl/worksheets/sheet1.xml", document);
    }

    private static XElement JcicRow(int row, int checkType, CheckFormulaItem item) =>
        new(S + "row", new XAttribute("r", row), new XAttribute("spans", "1:4"),
            NumberCell($"A{row}", checkType, "1"),
            TextCell($"B{row}", item.Formula, "0"));

    private static XElement DataRow(int row, CheckFormulaItem item, bool selfCheck) =>
        new(S + "row", new XAttribute("r", row), new XAttribute("spans", "1:5"),
            TextCell($"A{row}", item.Code, selfCheck ? "8" : "13"),
            TextCell($"B{row}", item.Description, selfCheck ? "10" : "14"),
            TextCell($"C{row}", item.Formula, selfCheck ? "7" : "14"),
            TextCell($"D{row}", item.SpecialMonth, "1"),
            TextCell($"E{row}", item.SpecialFormula, "1"));

    private static XElement NoteRow(int row, string note) =>
        new(S + "row", new XAttribute("r", row), new XAttribute("spans", "1:5"),
            EmptyCell($"A{row}", "9"), EmptyCell($"B{row}", "11"), TextCell($"C{row}", note, "6"));

    private static XElement SectionRow(int row, string title) =>
        new(S + "row", new XAttribute("r", row), new XAttribute("spans", "1:5"),
            new XAttribute("ht", "17.5"), new XAttribute("customHeight", "1"),
            TextCell($"A{row}", title, "12"), EmptyCell($"B{row}", "1"), EmptyCell($"C{row}", "1"));

    private static XElement HeaderRow(int row) =>
        new(S + "row", new XAttribute("r", row), new XAttribute("spans", "1:5"),
            new XAttribute("ht", "17.5"), new XAttribute("customHeight", "1"),
            TextCell($"A{row}", "﹝報表編號﹞項目代號欄位代號", "4"),
            TextCell($"B{row}", "檢核項目", "5"),
            TextCell($"C{row}", "項  目  代  號  關  係  式", "5"),
            EmptyCell($"D{row}", "1"), EmptyCell($"E{row}", "1"));

    private static XElement TextCell(string reference, string value, string style) =>
        new(S + "c", new XAttribute("r", reference), new XAttribute("s", style), new XAttribute("t", "inlineStr"),
            new XElement(S + "is", new XElement(S + "t", new XAttribute(Xml + "space", "preserve"), value ?? "")));

    private static XElement EmptyCell(string reference, string style) =>
        new(S + "c", new XAttribute("r", reference), new XAttribute("s", style));

    private static XElement NumberCell(string reference, int value, string style) =>
        new(S + "c", new XAttribute("r", reference), new XAttribute("s", style),
            new XElement(S + "v", value));

    private static XDocument ReadXml(ZipArchive archive, string path)
    {
        var entry = archive.GetEntry(path) ?? throw new InvalidOperationException($"Missing {path}");
        using var stream = entry.Open();
        return XDocument.Load(stream, LoadOptions.PreserveWhitespace);
    }

    private static void WriteXml(ZipArchive archive, string path, XDocument document)
    {
        archive.GetEntry(path)?.Delete();
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        using var writer = new StreamWriter(stream, new UTF8Encoding(false));
        document.Save(writer, SaveOptions.DisableFormatting);
    }

    private static MemoryStream CreateExpandableStream(string path)
    {
        var stream = new MemoryStream();
        var bytes = System.IO.File.ReadAllBytes(path);
        stream.Write(bytes, 0, bytes.Length);
        stream.Position = 0;
        return stream;
    }
}
