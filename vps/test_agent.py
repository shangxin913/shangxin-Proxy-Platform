import json
import subprocess
import unittest
from unittest.mock import patch

import agent


class ProbeTests(unittest.TestCase):
    def probe(self, payload, response=None):
        data = response if response is not None else {"ip": "203.0.113.10", "country": "MX"}
        with patch("agent.subprocess.run", return_value=subprocess.CompletedProcess([], 0, json.dumps(data), "")) as run:
            result = agent.check_socks5(payload)
            command = run.call_args.args[0]
            return result, command

    def test_socks5_does_not_respect_no_proxy_bypass(self):
        result, command = self.probe({"host": "proxy.example.test", "port": 1080})
        self.assertEqual(result["status"], "passed")
        self.assertEqual(command[command.index("--proxy") + 1], "socks5h://proxy.example.test:1080")
        self.assertEqual(command[command.index("--noproxy") + 1], "")

    def test_direct_ignores_proxy_environment(self):
        result, command = self.probe({"type": "direct"})
        self.assertEqual(result["observedIp"], "203.0.113.10")
        self.assertEqual(command[command.index("--proxy") + 1], "")
        self.assertEqual(command[command.index("--noproxy") + 1], "*")

    def test_invalid_ip_never_passes(self):
        result, _ = self.probe({"type": "direct"}, {"ip": "not-an-ip"})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["errorCode"], "invalid_exit_ip")

    def test_missing_ip_never_passes(self):
        result, _ = self.probe({"type": "direct"}, {})
        self.assertEqual(result["status"], "failed")

    def test_curl_failure_never_passes(self):
        with patch("agent.subprocess.run", side_effect=subprocess.CalledProcessError(7, [], stderr="connection refused")):
            result = agent.check_socks5({"host": "proxy.example.test", "port": 1080})
        self.assertEqual(result["status"], "failed")

    def test_credentials_cannot_inject_curl_config_lines(self):
        with self.assertRaises(ValueError):
            agent.check_socks5({"host": "proxy.example.test", "port": 1080, "password": 'secret\nurl = "https://evil.test"'})


if __name__ == "__main__":
    unittest.main()
