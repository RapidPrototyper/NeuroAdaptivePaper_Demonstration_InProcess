#!/usr/bin/env python3
"""
LSL Bridge Server with Tkinter GUI – for easy packaging as .exe
Receives WebSocket messages from the browser and forwards to a single LSL stream.
"""

import asyncio
import websockets
import json
import logging
from pylsl import StreamInfo, StreamOutlet
from datetime import datetime
import sys
import threading
import tkinter as tk
from tkinter import scrolledtext
import queue

# -----------------------------------------------------------------------------
# CONFIGURATION
# -----------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# LSL BRIDGE CLASS (same logic, now with GUI integration)
# -----------------------------------------------------------------------------

class LSLBridge:
    """Main class handling LSL stream and WebSocket connections"""

    def __init__(self, log_callback=None):
        self.outlet = None
        self.connected_clients = set()
        self.log_callback = log_callback   # function to send logs to GUI
        self.setup_lsl_stream()

    def log(self, msg):
        if self.log_callback:
            self.log_callback(msg)
        else:
            print(msg)

    def setup_lsl_stream(self):
        """Create a single LSL stream for all marker types"""
        try:
            info = StreamInfo(
                name='NeuroCursor_Markers',
                type='Markers',
                channel_count=1,
                nominal_srate=0,
                channel_format='string',
                source_id='neurocursor_experiment'
            )
            desc = info.desc()
            desc.append_child_value("manufacturer", "NeuroCursor Experiment")
            desc.append_child_value("description", "Experiment markers from Zander et al. (2016) replication")

            marker_types = desc.append_child("marker_types")
            for t in ["label", "cls1", "cls2", "classifyNow", "button", "event"]:
                marker_types.append_child_value("type", t)

            classifications = desc.append_child("classifications")
            cls1_node = classifications.append_child("cls1")
            for v in ["toward", "sideways", "away"]:
                cls1_node.append_child_value("value", v)
            cls2_node = classifications.append_child("cls2")
            for v in ["very good", "neutral", "very bad"]:
                cls2_node.append_child_value("value", v)

            buttons = desc.append_child("buttons")
            buttons.append_child_value("value", "50001")  # V
            buttons.append_child_value("value", "50002")  # B

            self.outlet = StreamOutlet(info)
            self.log("✅ LSL Stream created: 'NeuroCursor_Markers'")
        except Exception as e:
            self.log(f"❌ Error creating LSL stream: {e}")
            raise

    def send_to_lsl(self, marker_type, marker_value, jump_number=0):
        if not self.outlet:
            self.log("⚠️ LSL outlet not initialized")
            return False
        try:
            if marker_type == 'label':
                formatted_marker = marker_value
            elif marker_type == 'button':
                formatted_marker = marker_value
            else:
                formatted_marker = f"{marker_type}:{marker_value}"
            self.outlet.push_sample([formatted_marker])
            return True
        except Exception as e:
            self.log(f"❌ Error sending to LSL: {e}")
            return False

    async def handle_client(self, websocket, path):
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        self.log(f"🔌 New client connected: {client_ip}")
        self.connected_clients.add(websocket)

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    label = data.get('label')
                    cls1 = data.get('cls1')
                    cls2 = data.get('cls2')
                    classify_now = data.get('classifyNow')
                    button = data.get('button')
                    event = data.get('event')
                    phase = data.get('phase', 'unknown')
                    jump_number = data.get('jump', 0)

                    if label or button:
                        self.log(f"Jump {jump_number}, Phase: {phase}")

                    if label:
                        self.log(f"→ label: {label}")
                        self.send_to_lsl("label", label, jump_number)
                    if cls1:
                        self.log(f"→ cls1: {cls1}")
                        self.send_to_lsl("cls1", cls1, jump_number)
                    if cls2:
                        self.log(f"→ cls2: {cls2}")
                        self.send_to_lsl("cls2", cls2, jump_number)
                    if classify_now:
                        self.log(f"→ classifyNow: {classify_now}")
                        self.send_to_lsl("classifyNow", classify_now, jump_number)
                    if button:
                        self.log(f"→ button: {button}")
                        self.send_to_lsl("button", button, jump_number)
                    if event:
                        self.log(f"→ event: {event}")
                        self.send_to_lsl("event", event, jump_number)

                    ack = {"status": "received", "timestamp": datetime.now().isoformat(), "jump": jump_number}
                    await websocket.send(json.dumps(ack))

                except json.JSONDecodeError:
                    self.log("⚠️ Invalid JSON received")
                except Exception as e:
                    self.log(f"❌ Error processing message: {e}")

        except websockets.exceptions.ConnectionClosed:
            self.log(f"🔌 Client disconnected: {client_ip}")
        except Exception as e:
            self.log(f"❌ Error handling client {client_ip}: {e}")
        finally:
            self.connected_clients.discard(websocket)

# -----------------------------------------------------------------------------
# GUI APPLICATION
# -----------------------------------------------------------------------------

class LSLBridgeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("LSL Bridge Server – Muhammad Hinan Khan")
        self.root.geometry("700x500")
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

        self.bridge = None
        self.server_task = None
        self.loop = None
        self.stop_event = threading.Event()

        # GUI elements
        self.status_label = tk.Label(root, text="Status: Stopped", font=("Arial", 12, "bold"), fg="red")
        self.status_label.pack(pady=5)

        self.log_text = scrolledtext.ScrolledText(root, wrap=tk.WORD, height=20, font=("Courier", 9))
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.button_frame = tk.Frame(root)
        self.button_frame.pack(pady=5)

        self.start_btn = tk.Button(self.button_frame, text="Start Server", command=self.start_server, width=15)
        self.start_btn.pack(side=tk.LEFT, padx=5)

        self.stop_btn = tk.Button(self.button_frame, text="Stop Server", command=self.stop_server, width=15, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=5)

        self.quit_btn = tk.Button(self.button_frame, text="Quit", command=self.on_closing, width=15)
        self.quit_btn.pack(side=tk.LEFT, padx=5)

        # Queue for thread‑safe logging
        self.log_queue = queue.Queue()
        self.process_log_queue()

        # Start with server already running? (optional)
        # self.start_server()

    def log(self, msg):
        """Add a message to the log queue (thread-safe)."""
        self.log_queue.put(msg)

    def process_log_queue(self):
        """Process pending log messages on the main thread."""
        while not self.log_queue.empty():
            msg = self.log_queue.get_nowait()
            self.log_text.insert(tk.END, msg + "\n")
            self.log_text.see(tk.END)
        self.root.after(100, self.process_log_queue)

    def start_server(self):
        """Start the WebSocket server in a background thread."""
        if self.bridge:
            self.log("Server already running")
            return
        self.stop_event.clear()
        self.status_label.config(text="Status: Starting...", fg="orange")
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)

        # Create a new event loop for the background thread
        self.loop = asyncio.new_event_loop()
        self.bridge = LSLBridge(log_callback=self.log)

        # Run the server in a thread
        self.thread = threading.Thread(target=self._run_server, daemon=True)
        self.thread.start()

    def _run_server(self):
        """Run the asyncio server in the background thread."""
        asyncio.set_event_loop(self.loop)
        bridge = self.bridge

        async def serve():
            server = await websockets.serve(
                bridge.handle_client,
                "localhost",
                8765,
                ping_interval=20,
                ping_timeout=40,
                max_size=10 * 1024 * 1024
            )
            self.log("🚀 Server started on ws://localhost:8765")
            self.status_label.config(text="Status: Running", fg="green")
            self.stop_event.clear()
            await server.wait_closed()
            self.log("Server stopped.")

        try:
            self.loop.run_until_complete(serve())
        except Exception as e:
            self.log(f"❌ Server error: {e}")
            self.status_label.config(text="Status: Error", fg="red")
        finally:
            self.loop.close()
            self.bridge = None
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
            if not self.stop_event.is_set():
                self.status_label.config(text="Status: Stopped", fg="red")

    def stop_server(self):
        """Gracefully shut down the server."""
        if self.loop and self.loop.is_running():
            self.log("Stopping server...")
            self.stop_event.set()
            # Close all client connections
            if self.bridge:
                for ws in list(self.bridge.connected_clients):
                    self.loop.call_soon_threadsafe(ws.close)
            # Stop the server by closing the websockets server
            # We need to get the server task from the bridge? Simpler: we'll let the server wait_closed() finish.
            # We can't easily cancel from outside without a handle; we rely on client disconnections.
            # For graceful shutdown, we can close the loop after a short delay.
            self.status_label.config(text="Status: Stopping...", fg="orange")
            # Schedule a callback to stop the loop after a brief delay
            def stop_loop():
                self.loop.call_soon_threadsafe(self.loop.stop)
            self.loop.call_soon_threadsafe(stop_loop)
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
        else:
            self.log("Server not running")

    def on_closing(self):
        """Close the application."""
        self.stop_server()
        self.root.destroy()

# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    root = tk.Tk()
    app = LSLBridgeApp(root)
    root.mainloop()