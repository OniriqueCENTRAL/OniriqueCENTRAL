// audiotap : le son d'une seule application, ou de tout l'ordinateur sauf une application (Discord…), pour la WATCHPARTY
// de l'application ONIRIQUE CENTRAL. API de Windows « process loopback » (Windows 11 / build 20348 et plus).
//
//   audiotap.exe include <pid>   le son de ce processus et de ses enfants
//   audiotap.exe exclude <pid>   tout le son de l'ordinateur, sauf ce processus et ses enfants
//
// Sortie : PCM 16 bits signé, 48 kHz, stéréo entrelacé, sur stdout. S'arrête quand stdin se ferme (l'application est
// partie ou a coupé le partage). Erreurs sur stderr, code de sortie non nul.
// Compilation : tools/audiotap/build.cmd (Visual Studio Build Tools, SDK Windows).
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/implements.h>
#include <atomic>
#include <cstdio>
#include <cwchar>
#include <fcntl.h>
#include <io.h>
#include <thread>
#include <vector>

#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

// Reçoit le client audio quand Windows a fini de l'activer (l'activation est toujours asynchrone).
class Activation : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
                                                       Microsoft::WRL::FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;
  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT activated = E_FAIL;
    ComPtr<IUnknown> unknown;
    result = op->GetActivateResult(&activated, &unknown);
    if (SUCCEEDED(result)) result = activated;
    if (SUCCEEDED(result)) result = unknown.As(&client);
    SetEvent(done);
    return S_OK;
  }
};

static int fail(const char* what, HRESULT hr) {
  fprintf(stderr, "%s (0x%08lx)\n", what, static_cast<unsigned long>(hr));
  return 1;
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 3 || (wcscmp(argv[1], L"include") != 0 && wcscmp(argv[1], L"exclude") != 0)) {
    fprintf(stderr, "usage : audiotap include|exclude <pid>\n");
    return 2;
  }
  const bool include = wcscmp(argv[1], L"include") == 0;
  const DWORD pid = wcstoul(argv[2], nullptr, 10);
  if (!pid) return fail("pid invalide", E_INVALIDARG);

  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return fail("COM indisponible", E_FAIL);
  _setmode(_fileno(stdout), _O_BINARY);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof(params);
  prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto activation = Microsoft::WRL::Make<Activation>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &prop, activation.Get(), &op);
  if (FAILED(hr)) return fail("activation refusée (Windows 11 ou build 20348 requis)", hr);
  if (WaitForSingleObject(activation->done, 10000) != WAIT_OBJECT_0) return fail("activation trop longue", E_FAIL);
  if (FAILED(activation->result)) return fail("activation impossible", activation->result);
  IAudioClient* client = activation->client.Get();

  // Le format est imposé au client de capture : Windows convertit lui-même ce que jouent les applications.
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                          200000 /* 20 ms, en unités de 100 ns */, 0, &format, nullptr);
  if (FAILED(hr)) return fail("initialisation impossible", hr);
  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (FAILED(hr = client->SetEventHandle(ready))) return fail("événement refusé", hr);
  ComPtr<IAudioCaptureClient> capture;
  if (FAILED(hr = client->GetService(IID_PPV_ARGS(&capture)))) return fail("capture indisponible", hr);
  if (FAILED(hr = client->Start())) return fail("démarrage impossible", hr);

  // stdin fermé : l'application ne veut plus du son.
  std::atomic<bool> stop{false};
  std::thread watch([&] {
    char byte;
    DWORD read = 0;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &read, nullptr) && read) {}
    stop = true;
    SetEvent(ready);
  });
  watch.detach();

  std::vector<BYTE> silence;
  while (!stop) {
    WaitForSingleObject(ready, 200);
    UINT32 packet = 0;
    while (!stop && SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      const size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        silence.assign(bytes, 0);
        data = silence.data();
      }
      const size_t written = fwrite(data, 1, bytes, stdout);
      capture->ReleaseBuffer(frames);
      if (written != bytes) { stop = true; break; } // l'application a fermé le tuyau
    }
    fflush(stdout);
  }
  client->Stop();
  return 0;
}
