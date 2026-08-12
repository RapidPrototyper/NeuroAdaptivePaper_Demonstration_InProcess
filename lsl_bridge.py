#!/usr/bin/env python3
"""
LSL Bridge Server for Neuroadaptive Cursor Experiment
Receives WebSocket messages from browser and forwards to SINGLE LSL stream
Marker types: label, cls1, cls2, classifyNow, button, event, predict
"""

import asyncio
import websockets
import json
import logging
from pylsl import StreamInfo, StreamOutlet
from datetime import datetime
import sys

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
# LSL BRIDGE CLASS
# -----------------------------------------------------------------------------

class LSLBridge:
    def __init__(self):
        self.outlet = None
        self.connected_clients = set()
        self.setup_lsl_stream()
    
    def setup_lsl_stream(self):
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
            marker_types.append_child_value("type", "label")
            marker_types.append_child_value("type", "cls1")
            marker_types.append_child_value("type", "cls2")
            marker_types.append_child_value("type", "classifyNow")
            marker_types.append_child_value("type", "button")
            marker_types.append_child_value("type", "event")
            marker_types.append_child_value("type", "predict")
            
            classifications = desc.append_child("classifications")
            cls1_node = classifications.append_child("cls1")
            cls1_node.append_child_value("value", "toward")
            cls1_node.append_child_value("value", "sideways")
            cls1_node.append_child_value("value", "away")
            
            cls2_node = classifications.append_child("cls2")
            cls2_node.append_child_value("value", "very good")
            cls2_node.append_child_value("value", "neutral")
            cls2_node.append_child_value("value", "very bad")
            
            buttons = desc.append_child("buttons")
            buttons.append_child_value("value", "50001")
            buttons.append_child_value("value", "50002")
            
            self.outlet = StreamOutlet(info)
            logger.info("✅ LSL Stream created: 'NeuroCursor_Markers'")
        except Exception as e:
            logger.error(f"❌ Error creating LSL stream: {e}")
            raise
    
    def send_to_lsl(self, marker_type, marker_value, jump_number=0):
        if not self.outlet:
            logger.warning("⚠️ LSL outlet not initialized")
            return False
        try:
            if marker_type == 'label' or marker_type == 'button' or marker_type == 'predict':
                formatted_marker = marker_value
            else:
                formatted_marker = f"{marker_type}:{marker_value}"
            self.outlet.push_sample([formatted_marker])
            return True
        except Exception as e:
            logger.error(f"❌ Error sending to LSL: {e}")
            return False
    
    async def handle_client(self, websocket, path):
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        logger.info(f"🔌 New client connected: {client_ip}")
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
                    predict = data.get('predict')
                    phase = data.get('phase', 'unknown')
                    jump_number = data.get('jump', 0)
                    
                    if label or button or predict:
                        logger.info(f"Jump {jump_number}, Phase: {phase}")
                    
                    if label:
                        logger.info(f"→ label: {label}")
                        self.send_to_lsl("label", label, jump_number)
                    
                    if cls1:
                        logger.info(f"→ cls1: {cls1}")
                        self.send_to_lsl("cls1", cls1, jump_number)
                    
                    if cls2:
                        logger.info(f"→ cls2: {cls2}")
                        self.send_to_lsl("cls2", cls2, jump_number)
                    
                    if classify_now:
                        logger.info(f"→ classifyNow: {classify_now}")
                        self.send_to_lsl("classifyNow", classify_now, jump_number)
                    
                    if button:
                        logger.info(f"→ button: {button}")
                        self.send_to_lsl("button", button, jump_number)
                    
                    if predict:
                        logger.info(f"→ predict: {predict}")
                        self.send_to_lsl("predict", predict, jump_number)
                    
                    if event:
                        logger.info(f"→ event: {event}")
                        self.send_to_lsl("event", event, jump_number)
                    
                    ack = {
                        "status": "received",
                        "timestamp": datetime.now().isoformat(),
                        "jump": jump_number
                    }
                    await websocket.send(json.dumps(ack))
                    
                except json.JSONDecodeError:
                    logger.warning(f"⚠️ Invalid JSON received")
                except Exception as e:
                    logger.error(f"❌ Error processing message: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"🔌 Client disconnected: {client_ip}")
        except Exception as e:
            logger.error(f"❌ Error handling client {client_ip}: {e}")
        finally:
            self.connected_clients.discard(websocket)

# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------

async def main():
    try:
        bridge = LSLBridge()
        server = await websockets.serve(
            bridge.handle_client,
            "localhost",
            8765,
            ping_interval=20,
            ping_timeout=40,
            max_size=10 * 1024 * 1024
        )
        
        print("=" * 60)
        print("🚀 LSL Bridge Server Started Successfully!")
        print("=" * 60)
        print(f"🌐 WebSocket URL: ws://localhost:8765")
        print("📡 Waiting for browser connection...")
        print("=" * 60)
        print("📊 SINGLE LSL Stream Available in LabRecorder:")
        print("   Name: NeuroCursor_Markers")
        print("   Contains marker types:")
        print("     1. label       - Full detailed marker")
        print("     2. cls1        - Direction classification")
        print("     3. cls2        - Quality classification")
        print("     4. classifyNow - BCI processing trigger")
        print("     5. button      - Button presses: 50001 (V), 50002 (B)")
        print("     6. event       - Experiment events")
        print("     7. predict     - Custom user-defined marker")
        print("=" * 60)
        print("💡 Press Ctrl+C to stop the server")
        print("=" * 60)
        
        await server.wait_closed()
        
    except OSError as e:
        if "Address already in use" in str(e):
            print("❌ Port 8765 is already in use!")
            print("   Another instance might be running.")
            print("   Solutions:")
            print("   1. Close any other running LSL bridge instances")
            print("   2. Use: `lsof -ti:8765 | xargs kill -9`")
            print("   3. Or change port 8765 in both files")
            sys.exit(1)
        else:
            print(f"❌ Failed to start server: {e}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        if sys.version_info < (3, 7):
            print("❌ Python 3.7 or higher is required")
            sys.exit(1)
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}")