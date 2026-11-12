import sys
import socket
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'receiver'))
from receiver import osc_packet, validate_destination

class TestReceiver(unittest.TestCase):
    def test_osc_int(self):
        packet = osc_packet({'address':'/composition/connectnextcolumn','valueType':'int','value':1})
        self.assertEqual(len(packet) % 4, 0)
        self.assertIn(b',i\x00\x00', packet)
        self.assertTrue(packet.endswith(struct.pack('>i',1)))

    def test_osc_float(self):
        packet=osc_packet({'address':'/composition/video/opacity','valueType':'float','value':0.5})
        self.assertIn(b',f\x00\x00',packet)
        self.assertTrue(packet.endswith(struct.pack('>f',0.5)))

    def test_osc_no_args(self):
        packet=osc_packet({'address':'/cue','valueType':'none'})
        self.assertIn(b',\x00\x00\x00',packet)

    def test_host_allowed_and_blocked(self):
        c={'allowed_networks':['127.0.0.0/8','192.168.0.0/16']}
        def fake_getaddrinfo(host,port):
            return [(socket.AF_INET,socket.SOCK_STREAM,6,'',(host,0))]
        with patch('socket.getaddrinfo',side_effect=fake_getaddrinfo):
            self.assertEqual(validate_destination('192.168.1.10',c),'192.168.1.10')
            with self.assertRaises(ValueError):
                validate_destination('8.8.8.8',c)

if __name__=='__main__': unittest.main()

class TestTransport(unittest.TestCase):
    def test_real_osc_to_local_udp(self):
        from receiver import run_action
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as receiver:
            receiver.bind(('127.0.0.1',0))
            receiver.settimeout(2)
            port=receiver.getsockname()[1]
            msg=run_action({'type':'osc','host':'127.0.0.1','port':port},
                           {'address':'/test/cue','valueType':'int','value':7},
                           {'allowed_networks':['127.0.0.0/8']})
            data,_=receiver.recvfrom(4096)
            self.assertIn(b'/test/cue',data)
            self.assertTrue(data.endswith(b'\x00\x00\x00\x07'))
            self.assertIn('not confirmed',msg)

    def test_real_tcp_send(self):
        from receiver import run_action
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as receiver:
            receiver.bind(('127.0.0.1',0))
            receiver.listen(1)
            port=receiver.getsockname()[1]
            msg=run_action({'type':'tcp','host':'127.0.0.1','port':port},
                           {'payload':'474F0D0A','encoding':'hex'},
                           {'allowed_networks':['127.0.0.0/8']})
            client,_=receiver.accept()
            with client:
                self.assertEqual(client.recv(99),b'GO\r\n')
            self.assertIn('4 bytes sent',msg)
