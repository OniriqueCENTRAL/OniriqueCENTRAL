using System.Runtime.InteropServices;

namespace Onirique;

/// <summary>
/// Le mélangeur de volume de Windows affiche le son du navigateur sous le nom et le logo du moteur (« Microsoft Edge
/// WebView2 »), car c'est un de ses processus qui joue. On renomme ces sessions audio : « ONIRIQUE Navigateur », notre logo.
/// </summary>
static class Melangeur
{
    public static void Nommer(IEnumerable<int> processus, string icone)
    {
        var pids = processus.ToHashSet();
        if (pids.Count == 0) return;
        try
        {
            var enumerateur = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            enumerateur.EnumAudioEndpoints(0 /* eRender */, 1 /* DEVICE_STATE_ACTIVE */, out var appareils);
            appareils.GetCount(out var n);
            for (uint i = 0; i < n; i++)
            {
                appareils.Item(i, out var appareil);
                var iid = typeof(IAudioSessionManager2).GUID;
                appareil.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out var objet);
                var gestionnaire = (IAudioSessionManager2)objet;
                gestionnaire.GetSessionEnumerator(out var sessions);
                sessions.GetCount(out var m);
                for (int j = 0; j < m; j++)
                {
                    sessions.GetSession(j, out var session);
                    if (session is not IAudioSessionControl2 s2) continue;
                    s2.GetProcessId(out var pid);
                    if (!pids.Contains((int)pid)) continue;
                    var contexte = Guid.Empty;
                    s2.GetDisplayName(out var nom);
                    if (nom != Installation.Nom) s2.SetDisplayName(Installation.Nom, ref contexte);
                    s2.GetIconPath(out var chemin);
                    if (chemin != icone) s2.SetIconPath(icone, ref contexte);
                }
            }
        }
        catch { }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flux, int etats, out IMMDeviceCollection appareils);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint n);
        [PreserveSig] int Item(uint i, out IMMDevice appareil);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int contexte, IntPtr parametres, [MarshalAs(UnmanagedType.IUnknown)] out object objet);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int n);
        [PreserveSig] int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int etat);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string nom);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string nom, ref Guid contexte);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string chemin);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string chemin, ref Guid contexte);
        [PreserveSig] int GetGroupingParam(out Guid groupe);
        [PreserveSig] int SetGroupingParam(ref Guid groupe, ref Guid contexte);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr a);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
    }
}
