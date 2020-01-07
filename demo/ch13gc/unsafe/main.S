TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/9-unsafe/main.go
  main.go:5		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:5		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  main.go:5		0x104e02d		7648			JBE 0x104e077				
  main.go:5		0x104e02f		4883ec20		SUBQ $0x20, SP				
  main.go:5		0x104e033		48896c2418		MOVQ BP, 0x18(SP)			
  main.go:5		0x104e038		488d6c2418		LEAQ 0x18(SP), BP			
  main.go:6		0x104e03d		48c74424082a000000	MOVQ $0x2a, 0x8(SP)			
  main.go:7		0x104e046		488d442408		LEAQ 0x8(SP), AX			
  main.go:7		0x104e04b		4889442410		MOVQ AX, 0x10(SP)			
  main.go:8		0x104e050		e81b46fdff		CALL runtime.printlock(SB)		
  main.go:8		0x104e055		488b442410		MOVQ 0x10(SP), AX			
  main.go:8		0x104e05a		48890424		MOVQ AX, 0(SP)				
  main.go:8		0x104e05e		e8ed4efdff		CALL runtime.printpointer(SB)		
  main.go:8		0x104e063		e88848fdff		CALL runtime.printnl(SB)		
  main.go:8		0x104e068		e88346fdff		CALL runtime.printunlock(SB)		
  main.go:9		0x104e06d		488b6c2418		MOVQ 0x18(SP), BP			
  main.go:9		0x104e072		4883c420		ADDQ $0x20, SP				
  main.go:9		0x104e076		c3			RET					
  main.go:5		0x104e077		e84489ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:5		0x104e07c		eba2			JMP main.main(SB)			
  :-1			0x104e07e		cc			INT $0x3				
  :-1			0x104e07f		cc			INT $0x3				
