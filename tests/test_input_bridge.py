import http.client
import json
import socket
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'receiver'))
from receiver import ReceiverClient

class FakeSocket:
    def __init__(self):self.messages=[]
    def send(self,raw):self.messages.append(json.loads(raw))
    def close(self):pass

class TestBridge(unittest.TestCase):
    def test_local_post_security_and_forward(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        data={'server_url':'http://127.0.0.1:8787','receiver_id':'test','receiver_key':'private-secret-for-test',
              'input_port':port,'allowed_networks':['127.0.0.0/8']}
        client=ReceiverClient(data,log=lambda _:None)
        ws=FakeSocket();client.ws=ws;client.connected=True
        try:
            client.bridge()
            def post(path,key):
                conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
                conn.request('POST',path,headers={'X-Clicker-Key':key})
                r=conn.getresponse();status=r.status;r.read();conn.close();return status
            self.assertEqual(post('/input/right','not-valid'),401)
            self.assertEqual(post('/input/right','private-secret-for-test'),202)
            self.assertEqual(ws.messages[-1],{'type':'input','kind':'http','key':'right'})
            uuid='a8aa7fdd-5f81-409b-8ffd-11a0fbd90aba'
            self.assertEqual(post('/trigger/'+uuid,'private-secret-for-test'),202)
            self.assertEqual(ws.messages[-1],{'type':'input','kind':'http','key':'test','buttonId':uuid})
            self.assertEqual(post('/trigger/NOT-UUID','private-secret-for-test'),404)
            client.connected=False
            self.assertEqual(post('/input/right','private-secret-for-test'),503)
        finally:
            client.shutdown()

if __name__=='__main__':unittest.main()
