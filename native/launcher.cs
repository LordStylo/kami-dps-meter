using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Kami DPS Meter")]
[assembly: System.Reflection.AssemblyProduct("Kami DPS Meter")]
[assembly: System.Reflection.AssemblyDescription("Kami desktop launcher")]
[assembly: System.Reflection.AssemblyVersion("0.7.0.0")]
internal static class Launcher {
    private const string NpcapUrl = "https://npcap.com/#download";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    [STAThread] private static int Main(string[] args) {
        Application.EnableVisualStyles();
        bool startup = Array.Exists(args, a => a == "--startup"), stop = false, check = Array.Exists(args, a => a == "--check" || a.StartsWith("--check=")), quiet = Array.Exists(args, a => a == "--quiet");
        string checkFile = null;
        try {
            string root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            string markerPath = Path.Combine(root, "installed.json");
            bool installed = false; int markerPort = 4317;
            if (File.Exists(markerPath)) {
                var marker = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(markerPath));
                if (!marker.ContainsKey("format") || Convert.ToString(marker["format"]) != "kami-installed/1") throw new Exception("Kurulum bilgisi geçersiz.");
                installed = true;
                if (marker.ContainsKey("port")) markerPort = Convert.ToInt32(marker["port"]);
            }
            int port = markerPort; string envPort = Environment.GetEnvironmentVariable("AION_METER_PORT");
            if (!String.IsNullOrEmpty(envPort) && !Int32.TryParse(envPort, out port)) throw new Exception("Geçersiz uygulama bağlantı noktası.");
            foreach (string arg in args) {
                if (arg == "--startup") startup = true;
                else if (arg == "--stop") stop = true;
                else if (arg == "--quiet") quiet = true;
                else if (arg == "--check") check = true;
                else if (arg.StartsWith("--check=", StringComparison.Ordinal)) { check = true; checkFile = Path.GetFullPath(arg.Substring(8)); }
                else if (arg.StartsWith("--port=", StringComparison.Ordinal) && Int32.TryParse(arg.Substring(7), out port)) { }
                else throw new Exception("Bilinmeyen başlatıcı seçeneği: " + arg);
            }
            if (port < 1024 || port > 65535) throw new Exception("Geçersiz uygulama bağlantı noktası.");
            string data = Environment.GetEnvironmentVariable("AION_DATA_DIR");
            if (String.IsNullOrWhiteSpace(data)) data = installed ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Kami DPS Meter", "data") : root;
            data = Path.GetFullPath(data);
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            string[] required = { "scripts/start.ps1", "scripts/stop.ps1", "runtime/node.exe", "runtime/electron/electron.exe", "overlay/main.cjs", "src/server.mjs" };
            var missing = new List<string>();
            foreach (string relative in required) if (!File.Exists(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)))) missing.Add(relative);
            if (!File.Exists(powershell)) missing.Add("Windows PowerShell");
            if (check) {
                string report = Json.Serialize(new { format = "kami-launcher-check/1", root = root, installed = installed, dataDir = data, port = port, missing = missing.ToArray() });
                if (checkFile != null) File.WriteAllText(checkFile, report, new UTF8Encoding(false));
                Console.Out.WriteLine(report); return missing.Count == 0 ? 0 : 2;
            }
            if ((!stop && missing.Count > 0) || (stop && (!File.Exists(Path.Combine(root, "scripts", "stop.ps1")) || !File.Exists(powershell)))) throw new Exception("Uygulama dosyaları eksik. Kurulumu yeniden çalıştırın.");
            if (!stop && !File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "Npcap", "wpcap.dll"))) {
                if (!startup && !quiet) ShowNpcap(); return 3;
            }
            string script = Path.Combine(root, "scripts", stop ? "stop.ps1" : "start.ps1");
            var info = new ProcessStartInfo(powershell) {
                Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) + " -Port " + port + (stop ? "" : startup ? " -Overlay" : " -Application"),
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            info.EnvironmentVariables["AION_METER_PORT"] = port.ToString();
            if (installed || !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("AION_DATA_DIR"))) info.EnvironmentVariables["AION_DATA_DIR"] = data;
            var output = new StringBuilder();
            using (var process = new Process { StartInfo = info }) {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                if (!process.WaitForExit(90000)) throw new Exception("Başlatma/kapatma yanıtı zaman aşımına uğradı. Uygulamanın durumunu kontrol edin.");
                process.WaitForExit();
                string logDir = Path.Combine(data, "tmp"); Directory.CreateDirectory(logDir);
                File.AppendAllText(Path.Combine(logDir, "launcher.log"), DateTime.UtcNow.ToString("o") + " " + (stop ? "stop" : startup ? "startup" : "application") + " exit=" + process.ExitCode + Environment.NewLine + output.ToString(), new UTF8Encoding(false));
                if (process.ExitCode != 0 && !startup && !quiet) MessageBox.Show("Uygulama " + (stop ? "kapatılamadı." : "başlatılamadı.") + "\n\n" + output.ToString(), "Kami DPS Meter", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return process.ExitCode;
            }
        } catch (Exception e) {
            if (!startup && !quiet && !check) MessageBox.Show(e.Message, "Kami DPS Meter", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    private static void ShowNpcap() {
        using (var form = new Form { Text = "Kami DPS Meter · Npcap gerekli", Width = 460, Height = 210, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen }) {
            var label = new Label { Left = 22, Top = 20, Width = 405, Height = 65, Text = "Canlı oyun verisini okumak için Npcap kurulmalı.\nNpcap bu kurulum paketine dahil değildir. Resmi indirme sayfasını aşağıdaki bağlantıyla açabilirsiniz." };
            var link = new LinkLabel { Left = 22, Top = 91, Width = 400, Height = 25, Text = NpcapUrl };
            link.LinkClicked += delegate { Process.Start(new ProcessStartInfo(NpcapUrl) { UseShellExecute = true }); };
            var close = new Button { Text = "Kapat", Left = 340, Top = 130, Width = 85, DialogResult = DialogResult.OK };
            form.Controls.Add(label); form.Controls.Add(link); form.Controls.Add(close); form.AcceptButton = close; form.CancelButton = close; form.ShowDialog();
        }
    }
}
