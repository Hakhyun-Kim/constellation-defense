// Unity sample: dedicated-server protocol smoke test.
//
// Drop this file into a Unity project (Assets/Tests/, assembly with
// "UnityEngine.TestRunner" + "System.Net.WebSockets" available; Unity 2021+)
// and run it from the Test Runner while `npm run dedicated` is running, or
// point DEDICATED_URL elsewhere. No game rendering is attempted here — this
// verifies the same wire contract that scripts/dedicated-check.mjs enforces,
// so a future Unity viewer starts from a known-good connection layer.
//
// Honest status: written against dedicated/PROTOCOL.md and kept in sync with
// the Node conformance check; it compiles only inside a Unity project and was
// not executed on the machine that authored it (no Unity installed there).

using System;
using System.Collections;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine.TestTools;

public class DedicatedProtocolSmokeTest
{
    private const string DefaultUrl = "ws://127.0.0.1:8643/";

    private static string ServerUrl =>
        Environment.GetEnvironmentVariable("DEDICATED_URL") ?? DefaultUrl;

    [UnityTest]
    public IEnumerator ViewerReceivesWelcomeAndSnapshot()
    {
        var task = RunViewerFlow();
        while (!task.IsCompleted) yield return null;
        if (task.IsFaulted) throw task.Exception.GetBaseException();
    }

    private static async Task RunViewerFlow()
    {
        using var socket = new ClientWebSocket();
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        await socket.ConnectAsync(new Uri(ServerUrl), cancel.Token);

        await Send(socket, "{\"type\":\"hello\",\"role\":\"viewer\"}", cancel.Token);

        // 1) welcome: protocol v1, role viewer.
        string welcome = await Receive(socket, cancel.Token);
        StringAssert.Contains("\"type\":\"welcome\"", welcome);
        StringAssert.Contains("\"protocol\":1", welcome);
        StringAssert.Contains("\"role\":\"viewer\"", welcome);

        // 2) first snapshot: documented schema fields exist.
        string snapshot = await ReceiveOfType(socket, "\"type\":\"snapshot\"", cancel.Token);
        foreach (string field in new[] { "\"tick\"", "\"phase\"", "\"wave\"", "\"castleHp\"", "\"enemies\"", "\"board\"" })
            StringAssert.Contains(field, snapshot);

        // 3) commands are refused without the controller key.
        await Send(socket, "{\"type\":\"command\",\"op\":\"pause\"}", cancel.Token);
        string refusal = await ReceiveOfType(socket, "\"code\":\"forbidden\"", cancel.Token);
        StringAssert.Contains("\"type\":\"error\"", refusal);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", cancel.Token);
    }

    private static Task Send(ClientWebSocket socket, string json, CancellationToken token) =>
        socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)),
            WebSocketMessageType.Text, true, token);

    private static async Task<string> Receive(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[512 * 1024];
        var builder = new StringBuilder();
        while (true)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
            builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            if (result.EndOfMessage) return builder.ToString();
        }
    }

    private static async Task<string> ReceiveOfType(ClientWebSocket socket, string marker, CancellationToken token)
    {
        // Skip unrelated broadcasts (events/decisions) until the marker arrives.
        for (int i = 0; i < 200; i++)
        {
            string message = await Receive(socket, token);
            if (message.Contains(marker)) return message;
        }
        throw new TimeoutException($"No message containing {marker}");
    }
}
