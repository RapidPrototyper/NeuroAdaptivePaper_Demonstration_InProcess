#!/usr/bin/env python3
"""
LSL Bridge Server for Neuroadaptive Cursor Experiment
Receives WebSocket messages from browser and forwards to LSL
"""

import asyncio
import websockets
import json
import logging
from pylsl import StreamInfo, StreamOutlet
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

class LSLBridge:
    def __init__(self):
        self.outlet_cls1 = None
        self.outlet_cls2 = None
        self.connected_clients = set()
        self.setup_lsl_streams()
    
    def setup_lsl_streams(self):
        """Create LSL streams for cls1 and cls2"""
        try:
            # Stream for cls1 (movement direction: toward/sideways/away)
            info_cls1 = StreamInfo(
                name='NeuroCursor_cls1',
                type='Markers',
                channel_count=1,
                nominal_srate=0,  # Irregular rate
                channel_format='string',
                source_id='neurocursor_cls1'
            )
            self.outlet_cls1 = StreamOutlet(info_cls1)
            logger.info("✅ LSL Stream 1 created: 'NeuroCursor_cls1'")
            
            # Stream for cls2 (movement quality: very good/neutral/very bad)
            info_cls2 = StreamInfo(
                name='NeuroCursor_cls2',
                type='Markers',
                channel_count=1,
                nominal_srate=0,  # Irregular rate
                channel_format='string',
                source_id='neurocursor_cls2'
            )
            self.outlet_cls2 = StreamOutlet(info_cls2)
            logger.info("✅ LSL Stream 2 created: 'NeuroCursor_cls2'")
            
            logger.info("🎯 LSL streams ready. Open LabRecorder to see them.")
            
        except Exception as e:
            logger.error(f"❌ Error creating LSL streams: {e}")
            raise
    
    def send_to_lsl(self, cls1_value=None, cls2_value=None):
        """Send values to LSL streams"""
        try:
            if cls1_value and self.outlet_cls1:
                self.outlet_cls1.push_sample([cls1_value])
                logger.debug(f"📤 LSL cls1: '{cls1_value}'")
            
            if cls2_value and self.outlet_cls2:
                self.outlet_cls2.push_sample([cls2_value])
                logger.debug(f"📤 LSL cls2: '{cls2_value}'")
                
        except Exception as e:
            logger.error(f"❌ Error sending to LSL: {e}")
    
    async def handle_client(self, websocket, path):
        """Handle incoming WebSocket connections"""
        client_ip = websocket.remote_address[0]
        logger.info(f"🔌 New client connected: {client_ip}")
        self.connected_clients.add(websocket)
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    
                    # Extract data
                    cls1 = data.get('cls1')
                    cls2 = data.get('cls2')
                    phase = data.get('phase')
                    jump_number = data.get('jump', 0)
                    
                    # Log received data
                    logger.info(f"📨 Received: Jump {jump_number}, Phase: {phase}, cls1: {cls1}, cls2: {cls2}")
                    
                    # Only send to LSL during BCI phase
                    if phase == 'bci' and (cls1 or cls2):
                        self.send_to_lsl(cls1_value=cls1, cls2_value=cls2)
                        logger.info(f"🎯 BCI Phase - Sent to LSL: '{cls1}', '{cls2}'")
                    
                    # Send acknowledgment back to client
                    ack = {
                        "status": "received", 
                        "timestamp": datetime.now().isoformat(),
                        "jump": jump_number
                    }
                    await websocket.send(json.dumps(ack))
                    
                except json.JSONDecodeError:
                    logger.warning(f"⚠️ Invalid JSON from {client_ip}: {message[:50]}...")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"🔌 Client disconnected: {client_ip}")
        finally:
            self.connected_clients.remove(websocket)

async def main():
    """Start WebSocket server and LSL bridge"""
    try:
        bridge = LSLBridge()
        
        # Start WebSocket server
        server = await websockets.serve(
            bridge.handle_client,
            "localhost",  # Listen only on localhost
            8765,         # Port number
            ping_interval=20,
            ping_timeout=40
        )
        
        # Display startup banner
        logger.info("=" * 50)
        logger.info("🚀 LSL Bridge Server Started Successfully!")
        logger.info("=" * 50)
        logger.info(f"🌐 WebSocket URL: ws://localhost:8765")
        logger.info(f"🔌 Listening on: 127.0.0.1:8765")
        logger.info("=" * 50)
        logger.info("📡 Waiting for browser connection...")
        logger.info("📊 LSL Streams Available in LabRecorder:")
        logger.info("   1. NeuroCursor_cls1")
        logger.info("   2. NeuroCursor_cls2")
        logger.info("=" * 50)
        logger.info("💡 Press Ctrl+C to stop the server")
        logger.info("=" * 50)
        
        # Keep server running
        await server.wait_closed()
        
    except Exception as e:
        logger.error(f"❌ Failed to start server: {e}")
        logger.error("Make sure:")
        logger.error("1. Python is installed correctly")
        logger.error("2. Requirements are installed: pip install -r requirements.txt")
        logger.error("3. Port 8765 is not in use")
        return

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n👋 Server stopped by user")
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")