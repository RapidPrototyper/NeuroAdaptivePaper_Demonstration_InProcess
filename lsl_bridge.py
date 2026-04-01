#!/usr/bin/env python3
"""
LSL Bridge Server for Neuroadaptive Cursor Experiment
Receives WebSocket messages from browser and forwards to SINGLE LSL stream
Four markers sent separately to same stream: label, cls1, cls2, classifyNow
Plus button markers: 50001 (V), 50002 (B)
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

# Configure logging - INFO level shows markers
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
    """Main class handling LSL stream and WebSocket connections"""
    
    def __init__(self):
        self.outlet = None        # Single LSL outlet
        self.connected_clients = set()
        self.setup_lsl_stream()
    
    def setup_lsl_stream(self):
        """Create a single LSL stream for all marker types"""
        try:
            # Create LSL stream for markers
            info = StreamInfo(
                name='NeuroCursor_Markers',
                type='Markers',
                channel_count=1,
                nominal_srate=0,          # Irregular sampling rate
                channel_format='string',
                source_id='neurocursor_experiment'
            )
            
            # Add stream metadata
            desc = info.desc()
            desc.append_child_value("manufacturer", "NeuroCursor Experiment")
            desc.append_child_value("description", "Experiment markers from Zander et al. (2016) replication")
            
            # Define marker types
            marker_types = desc.append_child("marker_types")
            marker_types.append_child_value("type", "label")        # Full detailed marker
            marker_types.append_child_value("type", "cls1")         # Direction classification
            marker_types.append_child_value("type", "cls2")         # Quality classification
            marker_types.append_child_value("type", "classifyNow")  # BCI processing trigger
            marker_types.append_child_value("type", "button")       # Button press markers
            marker_types.append_child_value("type", "event")        # Experiment events
            
            # Define classification values
            classifications = desc.append_child("classifications")
            
            # Direction classifications (cls1)
            cls1_node = classifications.append_child("cls1")
            cls1_node.append_child_value("value", "toward")
            cls1_node.append_child_value("value", "sideways")
            cls1_node.append_child_value("value", "away")
            
            # Quality classifications (cls2)
            cls2_node = classifications.append_child("cls2")
            cls2_node.append_child_value("value", "very good")
            cls2_node.append_child_value("value", "neutral")
            cls2_node.append_child_value("value", "very bad")
            
            # Button press values
            buttons = desc.append_child("buttons")
            buttons.append_child_value("value", "50001")  # V button
            buttons.append_child_value("value", "50002")  # B button
            
            # Create the LSL outlet
            self.outlet = StreamOutlet(info)
            logger.info("✅ LSL Stream created: 'NeuroCursor_Markers'")
            
        except Exception as e:
            logger.error(f"❌ Error creating LSL stream: {e}")
            raise
    
    def send_to_lsl(self, marker_type, marker_value, jump_number=0):
        """
        Send a marker to the LSL stream
        
        Args:
            marker_type: Type of marker ('label', 'cls1', 'cls2', 'classifyNow', 'button', 'event')
            marker_value: The marker value to send
            jump_number: Current jump number for logging
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.outlet:
            logger.warning("⚠️ LSL outlet not initialized")
            return False
            
        try:
            # Format marker: label markers have no prefix, others keep type prefix
            if marker_type == 'label':
                # Send label markers without any prefix
                formatted_marker = marker_value
            elif marker_type == 'button':
                # Button markers are just the number (50001, 50002)
                formatted_marker = marker_value
            else:
                # Other markers include type prefix
                formatted_marker = f"{marker_type}:{marker_value}"
            
            # Send to LSL stream
            self.outlet.push_sample([formatted_marker])
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending to LSL: {e}")
            return False
    
    async def handle_client(self, websocket, path):
        """
        Handle incoming WebSocket connections and messages
        
        Args:
            websocket: The WebSocket connection
            path: Connection path (unused)
        """
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        logger.info(f"🔌 New client connected: {client_ip}")
        self.connected_clients.add(websocket)
        
        try:
            async for message in websocket:
                try:
                    # Parse incoming JSON message
                    data = json.loads(message)
                    
                    # Extract marker data
                    label = data.get('label')          # Full marker string
                    cls1 = data.get('cls1')            # Direction classification
                    cls2 = data.get('cls2')            # Quality classification
                    classify_now = data.get('classifyNow')  # NEW: BCI processing trigger
                    button = data.get('button')        # NEW: Button press (50001 or 50002)
                    event = data.get('event')          # Experiment events
                    phase = data.get('phase', 'unknown')
                    jump_number = data.get('jump', 0)
                    
                    # Log jump information
                    if label or button:
                        logger.info(f"Jump {jump_number}, Phase: {phase}")
                    
                    # 1. Send label marker (no prefix)
                    if label:
                        logger.info(f"→ label: {label}")
                        self.send_to_lsl("label", label, jump_number)
                    
                    # 2. Send direction classification
                    if cls1:
                        logger.info(f"→ cls1: {cls1}")
                        self.send_to_lsl("cls1", cls1, jump_number)
                    
                    # 3. Send quality classification
                    if cls2:
                        logger.info(f"→ cls2: {cls2}")
                        self.send_to_lsl("cls2", cls2, jump_number)
                    
                    # 4. NEW: Send classifyNow marker (for BCI phase)
                    if classify_now:
                        logger.info(f"→ classifyNow: {classify_now}")
                        self.send_to_lsl("classifyNow", classify_now, jump_number)
                    
                    # 5. NEW: Send button press markers (V=50001, B=50002)
                    if button:
                        logger.info(f"→ button: {button}")
                        self.send_to_lsl("button", button, jump_number)
                    
                    # 6. Send experiment events
                    if event:
                        logger.info(f"→ event: {event}")
                        self.send_to_lsl("event", event, jump_number)
                    
                    # Send acknowledgment back to browser
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
# MAIN SERVER FUNCTION
# -----------------------------------------------------------------------------

async def main():
    """Start the WebSocket server and LSL bridge"""
    try:
        # Create LSL bridge instance
        bridge = LSLBridge()
        
        # Start WebSocket server
        server = await websockets.serve(
            bridge.handle_client,
            "localhost",    # Listen only on localhost for security
            8765,           # Port number
            ping_interval=20,
            ping_timeout=40,
            max_size=10 * 1024 * 1024  # 10MB max message size
        )
        
        # Display startup information
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
        print("=" * 60)
        print("💡 Press Ctrl+C to stop the server")
        print("=" * 60)
        
        # Keep server running until stopped
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

# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        # Check Python version
        if sys.version_info < (3, 7):
            print("❌ Python 3.7 or higher is required")
            sys.exit(1)
        
        # Run the server
        asyncio.run(main())
        
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}")