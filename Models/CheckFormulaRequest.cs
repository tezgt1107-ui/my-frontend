namespace DevPilot.Models;

public sealed class CheckFormulaRequest
{
    public string TemplateId { get; set; } = "EximAPI2CBC";
    public List<CheckFormulaItem> SelfChecks { get; set; } = [];
    public List<CheckFormulaItem> CrossChecks { get; set; } = [];
}

public sealed class CheckFormulaItem
{
    public string Code { get; set; } = "";
    public string Description { get; set; } = "";
    public string Formula { get; set; } = "";
    public string Note { get; set; } = "";
    public string SpecialMonth { get; set; } = "";
    public string SpecialFormula { get; set; } = "";
}
