using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using DevPilot.Models;
using Microsoft.AspNetCore.Mvc;

namespace DevPilot.Controllers;

[ApiController]
[Route("api/change-list")]
public sealed class ChangeListController(IWebHostEnvironment environment) : ControllerBase
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Xml = XNamespace.Xml;

    [HttpPost("generate")]
    public IActionResult Generate([FromBody] ChangeListRequest request)
    {
        if (request.Items.Count == 0)
            return BadRequest(new { message = "至少需要一筆異動項目。" });
        if (request.Items.Count > 500)
            return BadRequest(new { message = "單次最多產生 500 筆異動項目。" });

        var templatePath = Path.Combine(environment.ContentRootPath, "Templates", "程式異動清單.xlsx");
        if (!System.IO.File.Exists(templatePath))
            return Problem("找不到 Excel 範本。");

        using var output = CreateExpandableStream(templatePath);
        using (var archive = new ZipArchive(output, ZipArchiveMode.Update, leaveOpen: true))
        {
            UpdateWorksheet(archive, request);
            UpdatePrintArea(archive, request.Items.Count);
        }
        var timestamp = DateTime.Now.ToString("yyyyMMddHHmmss");
        return File(output.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"程式異動清單_{timestamp}.xlsx");
    }

    private static void UpdateWorksheet(ZipArchive archive, ChangeListRequest request)
    {
        var document = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var sheetData = document.Root!.Element(Spreadsheet + "sheetData")!;
        var rows = sheetData.Elements(Spreadsheet + "row").ToList();
        var footerTemplate = new XElement(rows.Single(row => (int?)row.Attribute("r") == 22));
        var trailingTemplate = new XElement(rows.Single(row => (int?)row.Attribute("r") == 23));
        rows.Where(row =>
        {
            var number = (int?)row.Attribute("r") ?? 0;
            return number is >= 8 and <= 23;
        }).Remove();

        var insertAfter = sheetData.Elements(Spreadsheet + "row").Last(row => (int?)row.Attribute("r") == 7);
        foreach (var (item, index) in request.Items.Select((item, index) => (item, index)))
        {
            var rowNumber = 8 + index;
            var row = CreateDetailRow(rowNumber, index + 1, item);
            insertAfter.AddAfterSelf(row);
            insertAfter = row;
        }

        var footerRowNumber = 8 + request.Items.Count;
        ShiftRow(footerTemplate, footerRowNumber);
        SetInlineText(footerTemplate, $"B{footerRowNumber}", request.PersonName, "15");
        SetInlineText(footerTemplate, $"E{footerRowNumber}", request.ProjectManager, "17");
        insertAfter.AddAfterSelf(footerTemplate);

        ShiftRow(trailingTemplate, footerRowNumber + 1);
        footerTemplate.AddAfterSelf(trailingTemplate);

        SetInlineText(sheetData, "B4", request.ReleaseDate?.ToString("yyyy/MM/dd") ?? DateTime.Today.ToString("yyyy/MM/dd"), "24");
        SetInlineText(sheetData, "E4", request.Department, "26");
        SetInlineText(sheetData, "B5", request.SystemName, "28");
        SetInlineText(sheetData, "E5", request.ProjectCode, "28");
        SetInlineText(sheetData, "F3", request.Version, "8");

        var dimension = document.Root.Element(Spreadsheet + "dimension");
        dimension?.SetAttributeValue("ref", $"A2:F{footerRowNumber + 1}");
        UpdateMerges(document, request.Items.Count, footerRowNumber);
        WriteXml(archive, "xl/worksheets/sheet1.xml", document);
    }

    private static XElement CreateDetailRow(int rowNumber, int sequence, ChangeListItem item) =>
        new(Spreadsheet + "row",
            new XAttribute("r", rowNumber),
            new XAttribute("spans", "1:6"),
            NumberCell($"A{rowNumber}", sequence, "7"),
            TextCell($"B{rowNumber}", item.Server, "9"),
            TextCell($"C{rowNumber}", item.Item, "14"),
            TextCell($"D{rowNumber}", item.Path, "21"),
            new XElement(Spreadsheet + "c", new XAttribute("r", $"E{rowNumber}"), new XAttribute("s", "22")),
            TextCell($"F{rowNumber}", item.Remark, "10"));

    private static XElement NumberCell(string reference, int value, string style) =>
        new(Spreadsheet + "c", new XAttribute("r", reference), new XAttribute("s", style),
            new XElement(Spreadsheet + "v", value));

    private static XElement TextCell(string reference, string value, string style) =>
        new(Spreadsheet + "c",
            new XAttribute("r", reference), new XAttribute("s", style), new XAttribute("t", "inlineStr"),
            new XElement(Spreadsheet + "is",
                new XElement(Spreadsheet + "t", new XAttribute(Xml + "space", "preserve"), value ?? "")));

    private static void SetInlineText(XContainer container, string reference, string value, string style)
    {
        var cell = container.Descendants(Spreadsheet + "c").FirstOrDefault(item => (string?)item.Attribute("r") == reference);
        if (cell is not null)
        {
            cell.ReplaceWith(TextCell(reference, value, style));
            return;
        }
        var rowNumber = int.Parse(new string(reference.SkipWhile(char.IsLetter).ToArray()));
        var row = container.Descendants(Spreadsheet + "row").FirstOrDefault(item => (int?)item.Attribute("r") == rowNumber);
        row?.Add(TextCell(reference, value, style));
    }

    private static void ShiftRow(XElement row, int newNumber)
    {
        row.SetAttributeValue("r", newNumber);
        foreach (var cell in row.Elements(Spreadsheet + "c"))
        {
            var reference = (string?)cell.Attribute("r") ?? "";
            var column = new string(reference.TakeWhile(char.IsLetter).ToArray());
            cell.SetAttributeValue("r", $"{column}{newNumber}");
        }
    }

    private static void UpdateMerges(XDocument document, int itemCount, int footerRow)
    {
        var mergeCells = document.Root!.Element(Spreadsheet + "mergeCells")!;
        mergeCells.Elements(Spreadsheet + "mergeCell")
            .Where(merge =>
            {
                var reference = (string?)merge.Attribute("ref") ?? "";
                return reference.StartsWith("D8:", StringComparison.Ordinal) ||
                       reference.StartsWith("D9:", StringComparison.Ordinal) ||
                       reference.StartsWith("D1", StringComparison.Ordinal) ||
                       reference.StartsWith("D2", StringComparison.Ordinal) ||
                       reference is "B22:C22" or "E22:F22";
            }).Remove();
        for (var index = 0; index < itemCount; index++)
            mergeCells.Add(new XElement(Spreadsheet + "mergeCell", new XAttribute("ref", $"D{8 + index}:E{8 + index}")));
        mergeCells.Add(new XElement(Spreadsheet + "mergeCell", new XAttribute("ref", $"B{footerRow}:C{footerRow}")));
        mergeCells.Add(new XElement(Spreadsheet + "mergeCell", new XAttribute("ref", $"E{footerRow}:F{footerRow}")));
        mergeCells.SetAttributeValue("count", mergeCells.Elements(Spreadsheet + "mergeCell").Count());
    }

    private static void UpdatePrintArea(ZipArchive archive, int itemCount)
    {
        var document = ReadXml(archive, "xl/workbook.xml");
        var printArea = document.Descendants(Spreadsheet + "definedName")
            .FirstOrDefault(element => (string?)element.Attribute("name") == "_xlnm.Print_Area");
        if (printArea is not null) printArea.Value = $"sheet!$A$1:$F${9 + itemCount}";
        WriteXml(archive, "xl/workbook.xml", document);
    }

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
