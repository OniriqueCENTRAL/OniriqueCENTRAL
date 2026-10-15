// license-check verify <fichier> <plugin> <empreinte> <ancienne empreinte|-> <clé publique base64> <maintenant ms>
// license-check machine        les deux empreintes de cette machine
#include "../LicenseCore.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace onirique::license;

static std::vector<unsigned char> base64 (const std::string& s)
{
    std::vector<unsigned char> out;
    unsigned int acc = 0;
    int bits = 0;
    for (char c : s)
    {
        int v = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : c == '/' ? 63 : -1;
        if (v < 0) continue;
        acc = (acc << 6) | (unsigned) v;
        if ((bits += 6) >= 8) out.push_back ((unsigned char) (acc >> (bits -= 8)));
    }
    return out;
}

int main (int argc, char** argv)
{
    const std::string command = argc > 1 ? argv[1] : "";
    if (command == "machine")
    {
        std::printf ("%s %s\n", core::machineId().c_str(), core::legacyMachineId().c_str());
        return 0;
    }
    if (command == "verify" && argc == 8)
    {
        std::ifstream in (argv[2], std::ios::binary);
        const std::string contents ((std::istreambuf_iterator<char> (in)), std::istreambuf_iterator<char>());
        const auto key = base64 (argv[6]);
        const std::string legacy = std::string (argv[5]) == "-" ? std::string() : argv[5];
        const auto s = core::verify (contents, argv[3], argv[4], legacy, key.data(), std::strtoll (argv[7], nullptr, 10));
        const char* state = s.state == State::licensed ? "licensed" : s.state == State::trial ? "trial" : "unlicensed";
        std::printf ("%s email=%s renewal=%d \n", state, s.email.c_str(), s.renewal ? 1 : 0);
        return 0;
    }
    // license-check guard <plugin> : la licence de ce PC, puis la contre-vérification (avec ONIRIQUE_SEAL_TEST=1).
    if (command == "guard" && argc == 3)
    {
        core::Guard guard (argv[2]);
        for (int i = 0; i < 4; ++i)
            guard.refresh();
        const auto s = guard.status();
        std::printf ("%s sealed=%d renewal=%d\n", s.state == State::licensed ? "licensed" : s.state == State::trial ? "trial" : "unlicensed",
                     guard.sealed() ? 1 : 0, s.renewal ? 1 : 0);
        return 0;
    }
    std::fprintf (stderr, "usage : license-check verify|machine|guard\n");
    return 2;
}
