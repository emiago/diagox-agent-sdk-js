

# Setup

For running this examples here is diagox configuration needed

```yaml
version: "2.4"

transports: 
  udp:
    transport: "udp"
    bind: 0.0.0.0
    port: 5060

routes:
  default: # Default context goes every call from all endpoints
    - id: ""
      match: "any"
      endpoint: myagent

endpoints:
  localsoftphone:
    # Match any local call as incoming
    match: 
      type: "ip"
      values: ["127.0.0.1/24"]

  voicebot: 
    uri: "sip:localhost:5080" 

  myagent: 
    match:
      type: "agent" 
```