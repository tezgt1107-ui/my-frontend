namespace DevPilot.Models;

public sealed class ChangeListRequest
{
    public string PersonName { get; set; } = "";
    public string Department { get; set; } = "";
    public string SystemName { get; set; } = "";
    public string ProjectCode { get; set; } = "";
    public string Version { get; set; } = "";
    public string ProjectManager { get; set; } = "";
    public DateTime? ReleaseDate { get; set; }
    public List<ChangeListItem> Items { get; set; } = [];
}

public sealed class ChangeListItem
{
    public string Server { get; set; } = "";
    public string Item { get; set; } = "";
    public string Path { get; set; } = "";
    public string DestinationPath { get; set; } = "";
    public string Remark { get; set; } = "修改";
}
