TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/go/main.go
  main.go:7		0x104df70		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:7		0x104df79		483b6110		CMPQ 0x10(CX), SP			
  main.go:7		0x104df7d		7645			JBE 0x104dfc4				
  main.go:7		0x104df7f		4883ec28		SUBQ $0x28, SP				
  main.go:7		0x104df83		48896c2420		MOVQ BP, 0x20(SP)			
  main.go:7		0x104df88		488d6c2420		LEAQ 0x20(SP), BP			
  main.go:8		0x104df8d		488d055ed10100		LEAQ go.string.*+1874(SB), AX		
  main.go:8		0x104df94		4889442410		MOVQ AX, 0x10(SP)			
  main.go:8		0x104df99		48c74424180b000000	MOVQ $0xb, 0x18(SP)			
  main.go:8		0x104dfa2		c7042410000000		MOVL $0x10, 0(SP)			
  main.go:8		0x104dfa9		488d05b80c0200		LEAQ go.func.*+67(SB), AX		
  main.go:8		0x104dfb0		4889442408		MOVQ AX, 0x8(SP)			
  main.go:8		0x104dfb5		e876cefdff		CALL runtime.newproc(SB)		
  main.go:9		0x104dfba		488b6c2420		MOVQ 0x20(SP), BP			
  main.go:9		0x104dfbf		4883c428		ADDQ $0x28, SP				
  main.go:9		0x104dfc3		c3			RET					
  main.go:7		0x104dfc4		e8e788ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:7		0x104dfc9		eba5			JMP main.main(SB)			
  :-1			0x104dfcb		cc			INT $0x3				
  :-1			0x104dfcc		cc			INT $0x3				
  :-1			0x104dfcd		cc			INT $0x3				
  :-1			0x104dfce		cc			INT $0x3				
  :-1			0x104dfcf		cc			INT $0x3				
