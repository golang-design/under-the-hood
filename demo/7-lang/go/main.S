TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/go/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:3		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  main.go:3		0x104e02d		7645			JBE 0x104e074				
  main.go:3		0x104e02f		4883ec28		SUBQ $0x28, SP				
  main.go:3		0x104e033		48896c2420		MOVQ BP, 0x20(SP)			
  main.go:3		0x104e038		488d6c2420		LEAQ 0x20(SP), BP			
  main.go:4		0x104e03d		488d05d0d10100		LEAQ go.string.*+1876(SB), AX		
  main.go:4		0x104e044		4889442410		MOVQ AX, 0x10(SP)			
  main.go:4		0x104e049		48c74424180b000000	MOVQ $0xb, 0x18(SP)			
  main.go:4		0x104e052		c7042410000000		MOVL $0x10, 0(SP)			
  main.go:4		0x104e059		488d05280d0200		LEAQ go.func.*+65(SB), AX		
  main.go:4		0x104e060		4889442408		MOVQ AX, 0x8(SP)			
  main.go:4		0x104e065		e886cefdff		CALL runtime.newproc(SB)		
  main.go:5		0x104e06a		488b6c2420		MOVQ 0x20(SP), BP			
  main.go:5		0x104e06f		4883c428		ADDQ $0x28, SP				
  main.go:5		0x104e073		c3			RET					
  main.go:3		0x104e074		e84789ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:3		0x104e079		eba5			JMP main.main(SB)			
  :-1			0x104e07b		cc			INT $0x3				
  :-1			0x104e07c		cc			INT $0x3				
  :-1			0x104e07d		cc			INT $0x3				
  :-1			0x104e07e		cc			INT $0x3				
  :-1			0x104e07f		cc			INT $0x3				
