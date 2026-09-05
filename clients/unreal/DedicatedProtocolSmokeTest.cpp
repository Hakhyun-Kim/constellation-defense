// Unreal sample: dedicated-server protocol smoke test.
//
// Drop into an Unreal 5 project's test source (e.g. Source/<Game>/Tests/) with
// "WebSockets" and "Json" in the module's Build.cs dependencies, then run from
// Session Frontend → Automation while `npm run dedicated` is running.
// This verifies the same wire contract as scripts/dedicated-check.mjs so a
// future Unreal viewer starts from a known-good connection layer.
//
// Honest status: written against dedicated/PROTOCOL.md and kept in sync with
// the Node conformance check; it compiles only inside an Unreal project and
// was not executed on the machine that authored it (no Unreal installed there).

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "IWebSocket.h"
#include "Misc/AutomationTest.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "WebSocketsModule.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDedicatedProtocolSmokeTest,
    "ConstellationDefense.Dedicated.ProtocolSmoke",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

namespace
{
    TSharedPtr<FJsonObject> ParseJson(const FString& Text)
    {
        TSharedPtr<FJsonObject> Object;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
        FJsonSerializer::Deserialize(Reader, Object);
        return Object;
    }
}

bool FDedicatedProtocolSmokeTest::RunTest(const FString& Parameters)
{
    const FString Url = FPlatformMisc::GetEnvironmentVariable(TEXT("DEDICATED_URL")).IsEmpty()
        ? TEXT("ws://127.0.0.1:8643/")
        : FPlatformMisc::GetEnvironmentVariable(TEXT("DEDICATED_URL"));

    TSharedPtr<IWebSocket> Socket = FWebSocketsModule::Get().CreateWebSocket(Url);

    bool bWelcomeOk = false;      // welcome with protocol 1 and role viewer
    bool bSnapshotOk = false;     // snapshot carrying the documented fields
    bool bForbiddenOk = false;    // command refused without the controller key
    bool bDone = false;

    Socket->OnConnected().AddLambda([&]
    {
        Socket->Send(TEXT("{\"type\":\"hello\",\"role\":\"viewer\"}"));
    });

    Socket->OnMessage().AddLambda([&](const FString& Message)
    {
        const TSharedPtr<FJsonObject> Json = ParseJson(Message);
        if (!Json.IsValid()) { return; }
        const FString Type = Json->GetStringField(TEXT("type"));

        if (Type == TEXT("welcome"))
        {
            bWelcomeOk = Json->GetIntegerField(TEXT("protocol")) == 1
                && Json->GetStringField(TEXT("role")) == TEXT("viewer");
        }
        else if (Type == TEXT("snapshot") && !bSnapshotOk)
        {
            bSnapshotOk = Json->HasField(TEXT("tick")) && Json->HasField(TEXT("phase"))
                && Json->HasField(TEXT("wave")) && Json->HasField(TEXT("castleHp"))
                && Json->HasField(TEXT("enemies")) && Json->HasField(TEXT("board"));
            // Snapshot in hand: prove the auth boundary next.
            Socket->Send(TEXT("{\"type\":\"command\",\"op\":\"pause\"}"));
        }
        else if (Type == TEXT("error"))
        {
            if (Json->GetStringField(TEXT("code")) == TEXT("forbidden"))
            {
                bForbiddenOk = true;
                bDone = true;
            }
        }
    });

    Socket->OnConnectionError().AddLambda([&](const FString& Error)
    {
        AddError(FString::Printf(TEXT("Connection failed: %s (is `npm run dedicated` running?)"), *Error));
        bDone = true;
    });

    Socket->Connect();

    // Automation tests may block briefly; 15 s covers a cold local server.
    const double Deadline = FPlatformTime::Seconds() + 15.0;
    while (!bDone && FPlatformTime::Seconds() < Deadline)
    {
        FPlatformProcess::Sleep(0.05f);
    }
    Socket->Close();

    TestTrue(TEXT("welcome carried protocol v1 and viewer role"), bWelcomeOk);
    TestTrue(TEXT("snapshot carried the documented schema"), bSnapshotOk);
    TestTrue(TEXT("viewer command was refused (forbidden)"), bForbiddenOk);
    return bWelcomeOk && bSnapshotOk && bForbiddenOk;
}
