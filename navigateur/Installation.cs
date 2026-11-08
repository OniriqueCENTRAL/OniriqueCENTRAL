using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;

namespace Onirique;

// Installation dans le dossier de l'utilisateur (pas de droits administrateur), désinstallation depuis les
// Paramètres de Windows, inscription comme navigateur (choisissable par défaut) et mise à jour automatique.
static class Installation
{
    public const string Nom = "ONIRIQUE Navigateur";
    const string Manifeste = "https://onirique.store/telechargement/navigateur.json";
    const string CleDesinstallation = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ONIRIQUE Navigateur";
    const string CleClient = @"Software\Clients\StartMenuInternet\ONIRIQUE Navigateur";
    const string ProgId = "ONIRIQUEHTML";

    public static readonly string Dossier = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Nom);
    public static readonly string Exe = Path.Combine(Dossier, Nom + ".exe");
    static string RaccourciMenu => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Nom + ".lnk");
    static string RaccourciBureau => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Nom + ".lnk");

    public static string Version => typeof(Installation).Assembly.GetName().Version!.ToString(3);

    // L'icône vient du programme lui-même : celle du fichier passe par le cache de Windows, qui garde l'ancienne après une mise à jour.
    public static Icon Icone(int taille = 32) => new(typeof(Installation).Assembly.GetManifestResourceStream("icone.ico")!, taille, taille);

    [System.Runtime.InteropServices.DllImport("shell32.dll")] static extern void SHChangeNotify(int evenement, uint options, IntPtr a, IntPtr b);

    // La barre des tâches prend l'icône du fichier .exe dans un cache que Windows ne relit pas après une mise à jour.
    // La fenêtre lui donne donc la sienne : un fichier .ico qui porte le numéro de version, jamais en cache.
    [System.Runtime.InteropServices.ComImport, System.Runtime.InteropServices.Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     System.Runtime.InteropServices.InterfaceType(System.Runtime.InteropServices.ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        void GetCount(out uint n);
        void GetAt(uint i, out ClePropriete cle);
        void GetValue(ref ClePropriete cle, out Valeur v);
        void SetValue(ref ClePropriete cle, ref Valeur v);
        void Commit();
    }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 4)]
    struct ClePropriete { public Guid Format; public uint Id; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    struct Valeur { public ushort Type; ushort a, b, c; public IntPtr Texte; IntPtr d; }
    [System.Runtime.InteropServices.DllImport("shell32.dll")]
    static extern int SHGetPropertyStoreForWindow(IntPtr fenetre, ref Guid iid, [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Interface)] out IPropertyStore magasin);

    public static string CheminIcone => Path.Combine(EstInstallee ? Dossier : Parametres.Dossier, $"icone-{Version}.ico");

    static string EcrireIcone(string dossier)
    {
        Directory.CreateDirectory(dossier);
        var ico = Path.Combine(dossier, $"icone-{Version}.ico");
        if (!File.Exists(ico))
        {
            using (var flux = typeof(Installation).Assembly.GetManifestResourceStream("icone.ico")!)
            using (var fichier = File.Create(ico)) flux.CopyTo(fichier);
            foreach (var ancienne in Directory.GetFiles(dossier, "icone-*.ico")) if (ancienne != ico) try { File.Delete(ancienne); } catch { }
        }
        return ico;
    }

    public static void IconeDeBarreDesTaches(IntPtr fenetre)
    {
        try
        {
            var ico = EcrireIcone(EstInstallee ? Dossier : Parametres.Dossier);
            var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
            if (SHGetPropertyStoreForWindow(fenetre, ref iid, out var magasin) != 0) return;
            var format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
            void Poser(uint id, string texte)
            {
                var cle = new ClePropriete { Format = format, Id = id };
                var v = new Valeur { Type = 31, Texte = System.Runtime.InteropServices.Marshal.StringToCoTaskMemUni(texte) }; // VT_LPWSTR
                try { magasin.SetValue(ref cle, ref v); }
                finally { System.Runtime.InteropServices.Marshal.FreeCoTaskMem(v.Texte); }
            }
            Poser(5, "ONIRIQUE.Navigateur");                       // AppUserModel.ID
            Poser(2, $"\"{Environment.ProcessPath}\"");             // RelaunchCommand
            Poser(4, Nom);                                          // RelaunchDisplayNameResource
            Poser(3, ico + ",0");                                   // RelaunchIconResource
            magasin.Commit();
            System.Runtime.InteropServices.Marshal.ReleaseComObject(magasin);
        }
        catch { }
    }

    /// <summary>Après une nouvelle version : raccourcis réécrits et cache d'icônes de Windows prévenu, pour que le nouveau logo s'affiche partout.</summary>
    public static void RafraichirIcones()
    {
        try
        {
            if (File.Exists(RaccourciMenu)) Raccourci(RaccourciMenu);
            if (File.Exists(RaccourciBureau)) Raccourci(RaccourciBureau);
            using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(CleDesinstallation, true)) k?.SetValue("DisplayVersion", Version);
            SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); // SHCNE_ASSOCCHANGED : Windows relit les icônes
        }
        catch { }
    }
    public static bool EstInstallee => string.Equals(Path.GetFullPath(Environment.ProcessPath!), Path.GetFullPath(Exe), StringComparison.OrdinalIgnoreCase);

    public static void Installer(bool bureau)
    {
        Directory.CreateDirectory(Dossier);
        // Un navigateur déjà installé peut être ouvert : son fichier est renommé (Windows le permet), pas écrasé.
        if (File.Exists(Exe))
        {
            var ancien = Exe + ".ancien";
            try { File.Delete(ancien); } catch { }
            File.Move(Exe, ancien, true);
        }
        File.Copy(Environment.ProcessPath!, Exe);
        Raccourci(RaccourciMenu);
        if (bureau) Raccourci(RaccourciBureau);
        Inscrire();
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }

    static void Raccourci(string chemin)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        dynamic lien = shell.CreateShortcut(chemin);
        lien.TargetPath = Exe;
        lien.WorkingDirectory = Dossier;
        // Le .ico change de nom à chaque version : Windows ne peut pas resservir une icône vide gardée en cache pour le .exe.
        lien.IconLocation = EcrireIcone(Dossier) + ",0";
        lien.Description = Nom;
        lien.Save();
    }

    static void Inscrire()
    {
        string ouvrir = $"\"{Exe}\" \"%1\"";
        using (var k = Registry.CurrentUser.CreateSubKey(CleDesinstallation))
        {
            k.SetValue("DisplayName", Nom);
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", "ONIRIQUE");
            k.SetValue("DisplayIcon", Exe);
            k.SetValue("InstallLocation", Dossier);
            k.SetValue("UninstallString", $"\"{Exe}\" --desinstaller");
            k.SetValue("URLInfoAbout", "https://onirique.store/#navigateur");
            k.SetValue("EstimatedSize", (int)(new FileInfo(Exe).Length / 1024), RegistryValueKind.DWord);
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
        using (var k = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ProgId}"))
        {
            k.SetValue("", "Page web ONIRIQUE");
            k.CreateSubKey("DefaultIcon").SetValue("", Exe + ",0");
            k.CreateSubKey(@"shell\open\command").SetValue("", ouvrir);
        }
        using (var k = Registry.CurrentUser.CreateSubKey(CleClient))
        {
            k.SetValue("", Nom);
            k.CreateSubKey("DefaultIcon").SetValue("", Exe + ",0");
            k.CreateSubKey(@"shell\open\command").SetValue("", $"\"{Exe}\"");
            using var cap = k.CreateSubKey("Capabilities");
            cap.SetValue("ApplicationName", Nom);
            cap.SetValue("ApplicationDescription", "Le navigateur web léger d'ONIRIQUE.");
            cap.SetValue("ApplicationIcon", Exe + ",0");
            using var urls = cap.CreateSubKey("URLAssociations");
            urls.SetValue("http", ProgId);
            urls.SetValue("https", ProgId);
            using var fichiers = cap.CreateSubKey("FileAssociations");
            fichiers.SetValue(".htm", ProgId);
            fichiers.SetValue(".html", ProgId);
        }
        using (var k = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications"))
            k.SetValue(Nom, CleClient + @"\Capabilities");
    }

    public static void Desinstaller()
    {
        if (MessageBox.Show($"Désinstaller {Nom} ?", Nom, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        bool donnees = MessageBox.Show("Effacer aussi tes données de navigation (historique, cookies, mots de passe enregistrés, réglages) ?",
            Nom, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

        foreach (var lien in new[] { RaccourciMenu, RaccourciBureau }) try { File.Delete(lien); } catch { }
        Registry.CurrentUser.DeleteSubKeyTree(CleDesinstallation, false);
        Registry.CurrentUser.DeleteSubKeyTree(CleClient, false);
        Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\{ProgId}", false);
        using (var k = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true)) k?.DeleteValue(Nom, false);

        // Le fichier en cours d'exécution ne peut pas s'effacer lui-même : le dossier part juste après sa fermeture.
        var commande = $"/c timeout /t 3 /nobreak >nul & rmdir /s /q \"{Dossier}\"";
        if (donnees) commande += $" & rmdir /s /q \"{Parametres.Dossier}\"";
        Process.Start(new ProcessStartInfo("cmd.exe", commande) { CreateNoWindow = true, UseShellExecute = false });
        MessageBox.Show($"{Nom} est désinstallé.", Nom, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    /// <summary>Efface la version remplacée par la dernière mise à jour.</summary>
    public static void Nettoyer()
    {
        try { File.Delete(Exe + ".ancien"); } catch { }
    }

    sealed record Annonce(string version, string url, string sha256);

    /// <summary>Télécharge et met en place une version plus récente ; elle s'ouvre au prochain lancement.</summary>
    public static async Task<string?> MettreAJour()
    {
        if (!EstInstallee) return null;
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"ONIRIQUE-Navigateur/{Version}");
        var annonce = JsonSerializer.Deserialize<Annonce>(await http.GetStringAsync(Manifeste));
        if (annonce is null || !System.Version.TryParse(annonce.version, out var nouvelle) || nouvelle <= System.Version.Parse(Version)) return null;
        if (!annonce.url.StartsWith("https://onirique.store/telechargement/", StringComparison.Ordinal)) return null;

        var provisoire = Exe + ".maj";
        try
        {
            using (var reponse = await http.GetStreamAsync(annonce.url))
            using (var fichier = File.Create(provisoire))
            using (var empreinte = SHA256.Create())
            using (var crypto = new CryptoStream(fichier, empreinte, CryptoStreamMode.Write))
            {
                await reponse.CopyToAsync(crypto);
                crypto.FlushFinalBlock();
                if (!string.Equals(Convert.ToHexString(empreinte.Hash!), annonce.sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Empreinte différente de l'annonce.");
            }
            var ancien = Exe + ".ancien";
            try { File.Delete(ancien); } catch { }
            File.Move(Exe, ancien, true);
            File.Move(provisoire, Exe);
            using (var k = Registry.CurrentUser.OpenSubKey(CleDesinstallation, true)) k?.SetValue("DisplayVersion", annonce.version);
            return annonce.version;
        }
        finally { try { File.Delete(provisoire); } catch { } }
    }
}

sealed class FenetreInstallation : Form
{
    readonly Image? logo;
    bool bureau = true, enCours;
    float progression, affichee;
    string etat = "";
    readonly System.Windows.Forms.Timer minuteur = new() { Interval = 16 };

    public FenetreInstallation()
    {
        Text = "Installer " + Installation.Nom;
        Icon = Installation.Icone();
        logo = Installation.Icone(256).ToBitmap();
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = DA.Nuit;
        DoubleBuffered = true;
        ClientSize = new Size(this.S(520), this.S(340));
        Font = new Font("Segoe UI Variable Text", this.S(13), GraphicsUnit.Pixel);
        minuteur.Tick += (_, _) =>
        {
            affichee += (progression - affichee) * 0.18f;
            if (Math.Abs(progression - affichee) < 0.002f) affichee = progression;
            Invalidate();
        };
        minuteur.Start();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        DA.BarreSombre(Handle);
    }

    Rectangle Case => new(this.S(40), this.S(214), this.S(18), this.S(18));
    Rectangle BoutonInstaller => new(this.S(40), this.S(262), ClientSize.Width - this.S(80), this.S(46));

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        // La nuit, avec une tache braise floue.
        using (var halo = new GraphicsPath())
        {
            halo.AddEllipse(-this.S(160), -this.S(200), this.S(520), this.S(440));
            using var b = new PathGradientBrush(halo) { CenterColor = Color.FromArgb(120, DA.Sang), SurroundColors = new[] { Color.FromArgb(0, DA.Nuit) } };
            g.FillPath(b, halo);
        }
        if (logo != null) g.DrawImage(logo, this.S(36), this.S(34), this.S(84), this.S(84));
        using (var titre = new Font("Segoe UI Variable Display", this.S(26), FontStyle.Bold, GraphicsUnit.Pixel))
            TextRenderer.DrawText(g, "ONIRIQUE", titre, new Point(this.S(136), this.S(44)), DA.Brume, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, $"Navigateur · version {Installation.Version}", Font, new Point(this.S(138), this.S(84)), DA.Cendre, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, "Léger, sombre, et des onglets qui s'endorment quand tu ne les regardes pas.", Font,
            new Rectangle(this.S(40), this.S(146), ClientSize.Width - this.S(80), this.S(44)), DA.Etiquette, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);

        var c = Case;
        using (var chemin = DA.Arrondi(c, this.S(4)))
        {
            using var fond = new SolidBrush(bureau ? DA.Braise : DA.Fond);
            g.FillPath(fond, chemin);
            using var trait = new Pen(bureau ? DA.Braise : DA.Eteint);
            g.DrawPath(trait, chemin);
        }
        if (bureau)
        {
            using var coche = new Pen(Color.White, this.S(2)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLines(coche, new[] { new Point(c.X + this.S(4), c.Y + this.S(9)), new Point(c.X + this.S(8), c.Y + this.S(13)), new Point(c.X + this.S(14), c.Y + this.S(5)) });
        }
        TextRenderer.DrawText(g, "Créer un raccourci sur le Bureau", Font, new Point(c.Right + this.S(10), c.Y), DA.Brume, TextFormatFlags.NoPadding);

        var b2 = BoutonInstaller;
        using var forme = DA.Arrondi(b2, this.S(12));
        if (!enCours)
        {
            using var fond = new LinearGradientBrush(b2, DA.Braise, DA.Sang, LinearGradientMode.Vertical);
            g.FillPath(fond, forme);
            TextRenderer.DrawText(g, "INSTALLER", new Font("Cascadia Mono", this.S(13), FontStyle.Bold, GraphicsUnit.Pixel), b2, Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
        else
        {
            using var fond = new SolidBrush(DA.Fond);
            g.FillPath(fond, forme);
            var plein = new Rectangle(b2.X, b2.Y, Math.Max(this.S(24), (int)(b2.Width * affichee)), b2.Height);
            using var remplissage = DA.Arrondi(plein, this.S(12));
            using var braise = new LinearGradientBrush(b2, DA.Braise, DA.Sang, LinearGradientMode.Vertical);
            g.FillPath(braise, remplissage);
            TextRenderer.DrawText(g, etat, Font, b2, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Cursor = !enCours && (BoutonInstaller.Contains(e.Location) || Case.Contains(e.Location)) ? Cursors.Hand : Cursors.Default;
    }

    protected override async void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (enCours) return;
        if (Rectangle.Inflate(Case, this.S(4), this.S(4)).Contains(e.Location)) { bureau = !bureau; Invalidate(); return; }
        if (!BoutonInstaller.Contains(e.Location)) return;
        enCours = true;
        etat = "Installation…";
        progression = 0.15f;
        try
        {
            var depart = Task.Delay(700);
            await Task.Run(() => Installation.Installer(bureau));
            progression = 0.85f;
            await depart;
            progression = 1f;
            etat = "C'est prêt";
            await Task.Delay(450);
            Process.Start(new ProcessStartInfo(Installation.Exe) { UseShellExecute = true, WorkingDirectory = Installation.Dossier });
            Close();
        }
        catch (Exception ex)
        {
            enCours = false;
            MessageBox.Show(this, "L'installation n'a pas abouti : " + ex.Message, Installation.Nom, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Invalidate();
        }
    }
}
