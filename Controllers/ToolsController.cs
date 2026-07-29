using Microsoft.AspNetCore.Mvc;

namespace DevPilot.Controllers;

public sealed class ToolsController : Controller
{
    public IActionResult Json() => View();
    public IActionResult SqlIn() => View();
    public IActionResult SqlSanitizer() => View();
    public IActionResult SqlTestData() => View();
    public IActionResult DataConverter() => View();
    public IActionResult ChangeList() => View();
    public IActionResult CheckFormula() => View();
    public IActionResult Text() => View();
    public IActionResult Timestamp() => View();
    public IActionResult Jwt() => View();
    public IActionResult Encoder() => View();
    public IActionResult Regex() => View();
    public IActionResult Diff() => View();
    public IActionResult Generator() => View();
    public IActionResult LuckyWheel() => View();
}
