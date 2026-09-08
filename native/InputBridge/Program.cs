using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;

// Runs only in the student's interactive session, without elevation.
// No shell, files, arbitrary commands, hooks or key logging.
internal static class Program {
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public UNION data; }
    [StructLayout(LayoutKind.Explicit)] private struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
    [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    private static void Send(params INPUT[] inputs) { SendInput((uint)inputs.Length,inputs,Marshal.SizeOf<INPUT>()); }
    private static INPUT Mouse(int x,int y,uint flags)=>new(){type=0,data=new UNION{mouse=new MOUSEINPUT{dx=x,dy=y,dwFlags=flags}}};
    private static INPUT Key(ushort code,uint flags)=>new(){type=1,data=new UNION{key=new KEYBDINPUT{wVk=code,dwFlags=flags}}};
    private static INPUT Unicode(char code,uint flags)=>new(){type=1,data=new UNION{key=new KEYBDINPUT{wScan=code,dwFlags=flags|4}}};
    public static void Main() {
        string? line;
        while((line=Console.ReadLine())!=null){
            if(line.Length>1024)continue;
            try{
                using var doc=JsonDocument.Parse(line);var e=doc.RootElement;
                switch(e.GetProperty("kind").GetString()){
                    case "pointer":
                        var x=e.GetProperty("x").GetDouble();var y=e.GetProperty("y").GetDouble();
                        if(!double.IsFinite(x)||!double.IsFinite(y)||x<0||x>1||y<0||y>1)break;
                        // Absolute coordinates intentionally address the PRIMARY display,
                        // matching Electron's approved capture source; not virtual desktop.
                        var action=e.GetProperty("action").GetString();if(action!="move"&&action!="click"&&action!="right")break;
                        Send(Mouse((int)(x*65535),(int)(y*65535),0x8001));
                        if(action=="click")Send(Mouse(0,0,2),Mouse(0,0,4));
                        if(action=="right")Send(Mouse(0,0,8),Mouse(0,0,16));break;
                    case "key":
                        var key=e.GetProperty("key").GetString()??"";
                        if(key.Length==1&&(char.IsAsciiLetterOrDigit(key[0])||key==" ")){Send(Unicode(key[0],0),Unicode(key[0],2));break;}
                        ushort vk=key switch{"Enter"=>13,"Backspace"=>8,"Tab"=>9,"Escape"=>27,"ArrowLeft"=>37,"ArrowUp"=>38,"ArrowRight"=>39,"ArrowDown"=>40,_=>0};
                        if(vk!=0){uint extended=vk>=37&&vk<=40?1u:0u;Send(Key(vk,extended),Key(vk,extended|2));}break;
                }
            }catch(JsonException){}catch(InvalidOperationException){}catch(KeyNotFoundException){}catch(FormatException){}
        }
    }
}
