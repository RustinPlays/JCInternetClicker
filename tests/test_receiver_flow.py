import json
import socket
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'receiver'))
from receiver import ReceiverClient

class MockSocket:
    def __init__(self):self.messages=[]
    def send(self,raw):self.messages.append(json.loads(raw))
    def close(self):pass

class TestReceivedCommands(unittest.TestCase):
    def test_remote_test_ack_and_osc_execution(self):
        logs=[]
        cfg={'server_url':'http://127.0.0.1:8787','receiver_id':'x','receiver_key':'secret','input_port':9877,
             'allowed_networks':['127.0.0.0/8']}
        client=ReceiverClient(cfg,log=logs.append)
        ws=MockSocket();client.ws=ws
        client._on_message(ws,json.dumps({'type':'authenticated','name':'Test receiver'}))
        self.assertTrue(client.connected)
        self.assertEqual(ws.messages[-1]['type'],'info')
        client._on_message(ws,json.dumps({'type':'test','id':'test-id'}))
        self.assertEqual(ws.messages[-1]['id'],'test-id')
        self.assertTrue(ws.messages[-1]['ok'])
        self.assertTrue(any('RECEIVED FROM INTERNET: TEST SIGNAL' in x for x in logs))
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as listener:
            listener.bind(('127.0.0.1',0));listener.settimeout(2)
            port=listener.getsockname()[1]
            client._on_message(ws,json.dumps({'type':'execute','id':'osc-id',
                'target':{'name':'Arena test','type':'osc','host':'127.0.0.1','port':port},
                'action':{'address':'/composition/connectnextcolumn','valueType':'int','value':1}}))
            datagram,_=listener.recvfrom(1024)
            self.assertIn(b'/composition/connectnextcolumn',datagram)
            self.assertEqual(ws.messages[-1]['id'],'osc-id')
            self.assertTrue(ws.messages[-1]['ok'])

if __name__=='__main__':unittest.main()
